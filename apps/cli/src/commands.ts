/**
 * CLI commands available in Checkpoint 1. Each command is a pure function over its inputs so it can be unit
 * tested without a TTY; main.ts only parses argv and prints. Later checkpoints add project/chapter commands.
 */
import { readFileSync } from 'node:fs';
import {
  checkOutputLanguage,
  measure,
  toNfcText,
  verifyEvidence,
  segmentParagraphs,
} from '@yeonjae/prose';
import { loadPolicies, loadSchemas, validatorFor } from '@yeonjae/domain';
import {
  type Pool,
  approveManuscriptVersion,
  configFromEnv,
  createChapter,
  createEntity,
  createManuscriptVersion,
  createPool,
  createProject,
  createWorkspace,
  factsForEntity,
  getProject,
  listCommits,
  migrate,
  rollbackLatest,
  stateAt,
} from '@yeonjae/db';
import { acceptChapter, DeltaRejectedError } from '@yeonjae/canon';
import { compileBlock, composeIdentity, ProfileStore, type RoleVariant } from '@yeonjae/narrative';
import { PromptRegistry } from '@yeonjae/prompts';
import {
  acceptedChapter,
  indexAcceptedVersion,
  reindexProject,
  upsertL1Summary,
  withTransaction,
} from '@yeonjae/db';
import {
  buildPack,
  compileActiveConstraintSet,
  ContextError,
  PgLexicalRetriever,
  type ChapterContract,
  type StorySpec,
} from '@yeonjae/context';
import { loadPolicies as loadPolicyMap, type PolicyRef } from '@yeonjae/domain';

export interface CommandResult {
  readonly ok: boolean;
  readonly output: unknown;
}

export function cmdMeasure(path: string): CommandResult {
  const nfc = toNfcText(readFileSync(path, 'utf8'));
  return { ok: true, output: measure(nfc) };
}

export function cmdLanguageCheck(path: string, allowlist: readonly string[] = []): CommandResult {
  const nfc = toNfcText(readFileSync(path, 'utf8'));
  const r = checkOutputLanguage(nfc, { allowlist });
  return { ok: r.passed, output: r };
}

export function cmdValidate(schemaFile: string, instancePath: string): CommandResult {
  const instance = JSON.parse(readFileSync(instancePath, 'utf8')) as unknown;
  const r = validatorFor(schemaFile)(instance);
  return r.ok
    ? { ok: true, output: { valid: true, schema: schemaFile } }
    : { ok: false, output: { valid: false, errors: r.errors } };
}

export function cmdVerifyEvidence(manuscriptPath: string, deltaPath: string): CommandResult {
  const nfc = toNfcText(readFileSync(manuscriptPath, 'utf8'));
  const paragraphs = segmentParagraphs(nfc);
  const delta = JSON.parse(readFileSync(deltaPath, 'utf8')) as {
    items: {
      local_id: string;
      evidence: {
        start: number;
        end: number;
        quote: string;
        quote_hash?: string;
        paragraph_id?: string;
      }[];
    }[];
  };
  const results = delta.items.flatMap((item) =>
    item.evidence.map((ev, i) => {
      const verdict = verifyEvidence(nfc, {
        start: ev.start,
        end: ev.end,
        quote: ev.quote,
        quoteHash: ev.quote_hash,
      });
      const para = paragraphs.find((p) => p.start <= ev.start && ev.start < p.end);
      const paragraphOk = ev.paragraph_id === undefined || para?.id === ev.paragraph_id;
      return { item: item.local_id, evidence: i, verdict, paragraph_ok: paragraphOk };
    }),
  );
  const ok = results.every((r) => r.verdict.ok && r.paragraph_ok);
  return {
    ok,
    output: {
      checked: results.length,
      ok,
      failures: results.filter((r) => !r.verdict.ok || !r.paragraph_ok),
    },
  };
}

export function cmdPolicies(): CommandResult {
  const policies = loadPolicies();
  return {
    ok: true,
    output: [...policies.entries()].map(([ref, p]) => ({
      ref,
      tier: p.quality_tier,
      max_revision_rounds: p.revision.max_rounds,
      gates: Object.fromEntries(
        Object.entries(p.gates.dimensions).map(([k, v]) => [k, v.min_score]),
      ),
      calibration: p.calibration.status,
    })),
  };
}

export function cmdSchemas(): CommandResult {
  const { schemas } = loadSchemas();
  return { ok: true, output: [...schemas.keys()] };
}

export interface AsyncCommandResult extends CommandResult {
  readonly ok: boolean;
}

/** Commands that need Postgres (DATABASE_URL). Kept separate so the pure commands stay synchronous. */
export async function runDb(argv: readonly string[]): Promise<AsyncCommandResult> {
  const [cmd, ...rest] = argv;
  const pool = createPool(configFromEnv());
  try {
    switch (cmd) {
      case 'db:migrate': {
        return { ok: true, output: await migrate(pool) };
      }
      case 'project:create': {
        const [title] = rest;
        if (!title) return { ok: false, output: USAGE };
        const ws = await createWorkspace(pool, 'local');
        const p = await createProject(pool, { workspaceId: ws, title });
        return { ok: true, output: { workspace_id: ws, ...p } };
      }
      case 'entity:create': {
        const [projectId, type, displayName] = rest;
        if (!projectId || !type || !displayName) return { ok: false, output: USAGE };
        const project = await getProject(pool, projectId);
        const id = await createEntity(pool, {
          workspaceId: project.workspace_id,
          projectId,
          type,
          displayName,
        });
        return { ok: true, output: { entity_id: id } };
      }
      case 'manuscript:import': {
        const [projectId, chapterNo, file] = rest;
        if (!projectId || !chapterNo || !file) return { ok: false, output: USAGE };
        const project = await getProject(pool, projectId);
        const chapterId = await createChapter(pool, {
          workspaceId: project.workspace_id,
          projectId,
          number: Number(chapterNo),
        });
        const v = await createManuscriptVersion(pool, {
          workspaceId: project.workspace_id,
          projectId,
          chapterId,
          origin: 'imported',
          text: readFileSync(file, 'utf8'),
        });
        return {
          ok: true,
          output: {
            chapter_id: chapterId,
            manuscript_version_id: v.id,
            status: v.status,
            length: v.length,
          },
        };
      }
      case 'manuscript:approve': {
        const [versionId] = rest;
        if (!versionId) return { ok: false, output: USAGE };
        await approveManuscriptVersion(pool, versionId, 'cli');
        return { ok: true, output: { manuscript_version_id: versionId, status: 'approved' } };
      }
      case 'canon:accept': {
        const [projectId, chapterId, versionId, deltaFile] = rest;
        if (!projectId || !chapterId || !versionId || !deltaFile)
          return { ok: false, output: USAGE };
        const project = await getProject(pool, projectId);
        const timelines = await pool.query<{
          id: string;
          kind: 'main' | 'prior_loop' | 'alternate' | 'source_story';
        }>('SELECT id, kind FROM timelines WHERE project_id = $1', [projectId]);
        const main = timelines.rows.find((t) => t.kind === 'main');
        if (!main) return { ok: false, output: 'project has no main timeline' };
        try {
          const r = await acceptChapter(pool, {
            projectId,
            chapterId,
            manuscriptVersionId: versionId,
            delta: JSON.parse(readFileSync(deltaFile, 'utf8')) as unknown,
            timelines: new Map(timelines.rows.map((t) => [t.id, t.kind])),
            mainTimelineId: main.id,
            actor: { cli: true },
          });
          return { ok: true, output: { ...r, previous_version: project.canon_version } };
        } catch (err) {
          if (err instanceof DeltaRejectedError)
            return { ok: false, output: { rejected: true, issues: err.issues } };
          throw err;
        }
      }
      case 'canon:state-at': {
        const [projectId, entityId, chapterNo, ordinal] = rest;
        if (!projectId || !entityId || !chapterNo) return { ok: false, output: USAGE };
        const rows = await stateAt(pool, {
          projectId,
          entityId,
          clock: {
            chapter_no: Number(chapterNo),
            ordinal: Number(ordinal ?? '0'),
            precision: 'exact',
          },
        });
        return {
          ok: true,
          output: rows.map((f) => ({
            attribute: f.attribute,
            key: f.key,
            value_text: f.value_text ?? f.value,
            valid_from: f.valid_from,
            valid_to: f.valid_to,
            asserted_at_version: f.asserted_at_version,
          })),
        };
      }
      case 'canon:facts': {
        const [projectId, entityId] = rest;
        if (!projectId || !entityId) return { ok: false, output: USAGE };
        return { ok: true, output: await factsForEntity(pool, projectId, entityId) };
      }
      case 'canon:commits': {
        const [projectId] = rest;
        if (!projectId) return { ok: false, output: USAGE };
        return {
          ok: true,
          output: (await listCommits(pool, projectId)).map((c) => ({
            version: c.version,
            source: c.source,
            item_counts: c.item_counts,
            created_at: c.created_at,
          })),
        };
      }
      case 'canon:rollback': {
        const [projectId] = rest;
        if (!projectId) return { ok: false, output: USAGE };
        return { ok: true, output: await rollbackLatest(pool, projectId, { cli: true }) };
      }
      case 'summary:set': {
        const [projectId, chapterNo, summaryFile, hookFile] = rest;
        if (!projectId || !chapterNo || !summaryFile) return { ok: false, output: USAGE };
        const project = await getProject(pool, projectId);
        const lookup = await acceptedChapter(pool, projectId, Number(chapterNo));
        if (lookup.state !== 'accepted') {
          return {
            ok: false,
            output: {
              error: 'CHAPTER_NOT_ACCEPTED',
              detail: `chapter ${chapterNo} has no accepted version (${lookup.state}); summaries are stored only for accepted versions`,
            },
          };
        }
        const row = await withTransaction(pool, async (client) => {
          const r = await upsertL1Summary(client, {
            workspaceId: project.workspace_id,
            projectId,
            manuscriptVersionId: lookup.chapter.version.id,
            chapterNo: Number(chapterNo),
            text: readFileSync(summaryFile, 'utf8').trim(),
            endingHook: hookFile ? readFileSync(hookFile, 'utf8').trim() : undefined,
            canonVersion: lookup.chapter.acceptedCanonVersion,
          });
          const indexed = await indexAcceptedVersion(client, lookup.chapter.version.id);
          return { ...r, indexed_documents: indexed };
        });
        return {
          ok: true,
          output: {
            summary_id: row.id,
            manuscript_version_id: row.manuscript_version_id,
            content_hash: row.content_hash,
            indexed_documents: row.indexed_documents,
          },
        };
      }
      case 'search:index': {
        const [projectId, chapterNo] = rest;
        if (!projectId) return { ok: false, output: USAGE };
        if (chapterNo) {
          const lookup = await acceptedChapter(pool, projectId, Number(chapterNo));
          if (lookup.state !== 'accepted')
            return { ok: false, output: { error: 'CHAPTER_NOT_ACCEPTED', state: lookup.state } };
          const n = await withTransaction(pool, (c) =>
            indexAcceptedVersion(c, lookup.chapter.version.id),
          );
          return {
            ok: true,
            output: { manuscript_version_id: lookup.chapter.version.id, documents: n },
          };
        }
        return { ok: true, output: { documents: await reindexProject(pool, projectId) } };
      }
      case 'pack:build': {
        const [projectId, chapterNo, role, contractFile, specFile, ...flags] = rest;
        if (!projectId || !chapterNo || !role || !contractFile || !specFile)
          return { ok: false, output: USAGE };
        const identityFlag = flags.find((f) => f.startsWith('--identity='));
        return await cmdPackBuild(pool, {
          projectId,
          chapterNo: Number(chapterNo),
          role,
          contractFile,
          specFile,
          identityRef: identityFlag?.slice('--identity='.length),
          full: flags.includes('--full'),
          persist: flags.includes('--persist'),
          lexical: !flags.includes('--no-lexical'),
        });
      }
      default:
        return { ok: false, output: USAGE };
    }
  } finally {
    await pool.end();
  }
}

export interface PackBuildArgs {
  readonly projectId: string;
  readonly chapterNo: number;
  readonly role: string;
  readonly contractFile: string;
  readonly specFile: string;
  readonly identityRef?: string | undefined;
  readonly full: boolean;
  readonly persist: boolean;
  readonly lexical: boolean;
}

/**
 * Build a Context Pack from a contract + spec file. The default output is the manifest view (hashes, tokens,
 * items, degradation) and never prints manuscript text; `--full` adds the rendered prompt for local review.
 */
export async function cmdPackBuild(pool: Pool, args: PackBuildArgs): Promise<AsyncCommandResult> {
  const contract = JSON.parse(readFileSync(args.contractFile, 'utf8')) as ChapterContract;
  const spec = JSON.parse(readFileSync(args.specFile, 'utf8')) as StorySpec;
  if (contract.chapter_number !== args.chapterNo)
    return {
      ok: false,
      output: {
        error: 'TASK_INVALID',
        detail: `contract is for chapter ${contract.chapter_number}, command asked for ${args.chapterNo}`,
      },
    };
  const project = await getProject(pool, args.projectId);
  const policies = loadPolicyMap();
  const policy = policies.get(project.production_policy_version as PolicyRef);
  if (!policy)
    return {
      ok: false,
      output: { error: 'POLICY_UNKNOWN', detail: project.production_policy_version },
    };
  const store = ProfileStore.fromDirectory();
  const composedRef = args.identityRef ?? `project/${args.projectId}@1`;
  let identity;
  try {
    identity = composeIdentity(store, composedRef, contract.narrative_identity_version_id);
  } catch (err) {
    if (args.identityRef !== undefined)
      return {
        ok: false,
        output: {
          error: 'IDENTITY_UNKNOWN',
          detail: err instanceof Error ? err.message : String(err),
        },
      };
    identity = undefined;
  }
  try {
    const { pack, fetch, stored } = await buildPack(pool, {
      projectId: args.projectId,
      role: args.role,
      contract,
      spec,
      policy,
      identity,
      lexical: args.lexical ? new PgLexicalRetriever(pool) : undefined,
      persist: args.persist,
    });
    const m = pack.manifest;
    return {
      ok: true,
      output: {
        pack_id: m.pack_id,
        pack_hash: m.pack_hash,
        template: m.template,
        template_version: m.template_version,
        role: m.role,
        pinned: m.pinned,
        production_policy_version: m.production_policy_version,
        query_plan_hash: m.query_plan_hash,
        narrative_identity_block: m.narrative_identity_block,
        active_constraint_set: m.active_constraint_set,
        previous_chapter: m.previous_chapter,
        budget_tokens: m.budget_tokens,
        token_counts: m.token_counts,
        sections: m.sections.map((s) => ({
          name: s.name,
          tier: s.tier,
          tokens: s.tokens,
          hash: s.hash,
        })),
        included: m.items
          .filter((i) => i.included)
          .map((i) => ({
            id: i.id,
            tier: i.tier,
            tokens: i.tokens,
            source: `${i.source?.kind ?? '?'}:${i.source?.ref ?? '?'}@${i.source?.version ?? '?'}`,
            provenance: i.provenance,
          })),
        excluded: m.items
          .filter((i) => !i.included)
          .map((i) => ({ id: i.id, tier: i.tier, reason: i.drop_reason })),
        degraded: m.degraded,
        degradation: m.degradation,
        degradation_notes: m.degradation_notes,
        validation: m.validation,
        ladder_steps: pack.ladderSteps,
        constraints_excluded: fetch.constraints.excluded,
        stored,
        ...(args.full
          ? { rendered_system: pack.renderedSystem, rendered_user: pack.renderedUser }
          : {}),
      },
    };
  } catch (err) {
    if (err instanceof ContextError)
      return { ok: false, output: { error: err.code, detail: err.detail, data: err.data } };
    throw err;
  }
}

export function cmdConstraintsCompile(
  chapterNo: number,
  specFile: string,
  cap: string | undefined,
): CommandResult {
  const spec = JSON.parse(readFileSync(specFile, 'utf8')) as StorySpec;
  const capTokens = Number(cap ?? '1200');
  try {
    const acs = compileActiveConstraintSet(
      spec,
      { chapterNo, participantIds: [], specVersion: spec.version },
      { capTokens },
    );
    return {
      ok: true,
      output: {
        id: acs.id,
        content_hash: acs.contentHash,
        token_count: acs.tokenCount,
        hard: acs.hard.map((c) => c.id),
        soft: acs.soft.map((c) => c.id),
        assumptions: acs.assumptions.map((c) => c.id),
        excluded: acs.excluded,
        rendered_text: acs.renderedText,
      },
    };
  } catch (err) {
    if (err instanceof ContextError)
      return { ok: false, output: { error: err.code, detail: err.detail, data: err.data } };
    throw err;
  }
}

export const DB_COMMANDS = new Set([
  'db:migrate',
  'project:create',
  'entity:create',
  'manuscript:import',
  'manuscript:approve',
  'canon:accept',
  'canon:state-at',
  'canon:facts',
  'canon:commits',
  'canon:rollback',
  'summary:set',
  'search:index',
  'pack:build',
]);

export function cmdIdentityCompile(
  composedRef: string,
  role: string,
  budget: string | undefined,
): CommandResult {
  const store = ProfileStore.fromDirectory();
  const identity = composeIdentity(store, composedRef, '00000000-0000-7000-8000-000000000000');
  const block = compileBlock(identity, {
    role: role as RoleVariant,
    budgetTokens: Number(budget ?? '6000'),
  });
  return {
    ok: true,
    output: {
      identity: identity.ref,
      role: block.role,
      hash: block.hash,
      output_language_contract_hash: block.outputLanguageContractHash,
      tradition_contract_hash: block.traditionContractHash,
      sections: block.sections,
      dropped_sections: block.droppedSections,
      est_tokens: block.estTokens,
      conflicts: identity.conflicts,
      text: block.text,
    },
  };
}

export function cmdPromptsList(): CommandResult {
  const reg = PromptRegistry.fromDirectory();
  return {
    ok: true,
    output: {
      prompt_set: reg.activeSet(),
      versions: reg.list().map((v) => ({
        id: v.id,
        role: v.role,
        model_class: v.model_class,
        style_sensitive: v.style_sensitive,
        manuscript_producing: v.manuscript_producing,
        identity_variant: v.identity_variant,
        output_schema: v.output_schema,
        content_hash: v.content_hash,
        status: v.status,
      })),
    },
  };
}

export const USAGE = `yeonjae <command> [args]

  schemas                              list loaded JSON Schemas
  validate <schema-file> <json>        validate a JSON instance against schemas/<schema-file>
  measure <text-file>                  length model (words, code points, paragraphs, sentences, est. tokens)
  language-check <text-file> [terms…]  deterministic English output-language check (allowlist terms optional)
  verify-evidence <manuscript> <delta> verify every evidence span of a canon delta against the NFC manuscript
  policies                             list Production Policy versions and their per-dimension gates
  identity:compile <composed-ref> <role> [budget]
                                       compile the Narrative Identity Block (both contracts first) for a role variant
  prompts:list                         list immutable prompt versions and the active prompt set

Database commands (DATABASE_URL required):
  db:migrate                                   apply forward-only migrations
  project:create <title>                       create a workspace + project + main timeline
  entity:create <project> <type> <name>        add a bible entity
  manuscript:import <project> <chapter#> <file> store an immutable working version (NFC, measured)
  manuscript:approve <version>                 approval-lock a working version (gate outcome)
  canon:accept <project> <chapter> <version> <delta.json>
                                               verify the delta, then commit atomically (sets accepted)
  canon:state-at <project> <entity> <ch> [ord] facts valid at a story clock
  canon:facts <project> <entity>               full bitemporal history for an entity
  canon:commits <project>                      canon commit log
  canon:rollback <project>                     roll back the latest commit (new commit, version +1)
  summary:set <project> <chapter#> <summary.txt> [hook.txt]
                                               store the L1 summary (+ ending hook) of the ACCEPTED version of a chapter
  search:index <project> [chapter#]            (re)index accepted content for lexical retrieval (idempotent)
  pack:build <project> <chapter#> <role> <contract.json> <spec.json> [--identity=<composed-ref>] [--full] [--persist] [--no-lexical]
                                               build a Context Pack: manifest, section hashes, token estimates,
                                               included/excluded items and degradation flags; the composed
                                               identity defaults to project/<project>@1; --full prints the
                                               rendered prompt (manuscript excerpts) — local development only
  constraints:compile <chapter#> <spec.json> [cap]
                                               compile the Active Constraint Set for a chapter (no database)
`;

export function run(argv: readonly string[]): CommandResult {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'schemas':
      return cmdSchemas();
    case 'validate': {
      const [schema, file] = rest;
      if (!schema || !file) return { ok: false, output: USAGE };
      return cmdValidate(schema, file);
    }
    case 'measure': {
      const [file] = rest;
      if (!file) return { ok: false, output: USAGE };
      return cmdMeasure(file);
    }
    case 'language-check': {
      const [file, ...terms] = rest;
      if (!file) return { ok: false, output: USAGE };
      return cmdLanguageCheck(file, terms);
    }
    case 'verify-evidence': {
      const [manuscript, delta] = rest;
      if (!manuscript || !delta) return { ok: false, output: USAGE };
      return cmdVerifyEvidence(manuscript, delta);
    }
    case 'policies':
      return cmdPolicies();
    case 'identity:compile': {
      const [ref, role, budget] = rest;
      if (!ref || !role) return { ok: false, output: USAGE };
      return cmdIdentityCompile(ref, role, budget);
    }
    case 'prompts:list':
      return cmdPromptsList();
    case 'constraints:compile': {
      const [chapterNo, specFile, cap] = rest;
      if (!chapterNo || !specFile) return { ok: false, output: USAGE };
      return cmdConstraintsCompile(Number(chapterNo), specFile, cap);
    }
    default:
      return { ok: false, output: USAGE };
  }
}
