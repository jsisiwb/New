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
      default:
        return { ok: false, output: USAGE };
    }
  } finally {
    await pool.end();
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
]);

export const USAGE = `yeonjae <command> [args]

  schemas                              list loaded JSON Schemas
  validate <schema-file> <json>        validate a JSON instance against schemas/<schema-file>
  measure <text-file>                  length model (words, code points, paragraphs, sentences, est. tokens)
  language-check <text-file> [terms…]  deterministic English output-language check (allowlist terms optional)
  verify-evidence <manuscript> <delta> verify every evidence span of a canon delta against the NFC manuscript
  policies                             list Production Policy versions and their per-dimension gates

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
    default:
      return { ok: false, output: USAGE };
  }
}
