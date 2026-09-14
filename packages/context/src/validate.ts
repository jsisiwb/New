/**
 * Pre-call validation (docs/04-memory-canon/04 §2.7). Runs on every assembled pack before it may reach the
 * gateway; the gateway's Narrative Identity Guard re-checks the block independently. Every check is recorded
 * in the manifest; a failed check makes the pack unusable (`PACK_VALIDATION_FAILED` from `assertValidPack`).
 */
import { HEADER_PREFIX } from '@yeonjae/narrative';
import { ContextError } from './errors.js';
import { sha256, stableStringify } from './hash.js';
import { type ContextPack, renderItem } from './assemble.js';
import { type AssemblyInput, type Manifest } from './types.js';

export type ValidationChecks = Manifest['validation'];

export interface ValidationReport {
  readonly ok: boolean;
  readonly checks: ValidationChecks;
  readonly failures: readonly string[];
}

const CANON_KINDS = new Set([
  'fact',
  'locked_fact',
  'knowledge_state',
  'relationship_state',
  'event',
  'promise',
  'proposition',
  'world_rule',
  'evidence',
]);

export function validatePack(pack: ContextPack, input: AssemblyInput): ValidationReport {
  const failures: string[] = [];
  const t = pack.template;
  const prompt = `${pack.renderedSystem}\n\n${pack.renderedUser}`;

  // T0 items byte-for-byte, mandatory sections present.
  let t0ByteEqual = true;
  for (const item of pack.included.filter((i) => i.tier === 'T0')) {
    const rendered = renderItem(t, item, item.text);
    if (!prompt.includes(rendered)) {
      t0ByteEqual = false;
      failures.push(`T0 item ${item.id} is not present byte-for-byte in the rendered prompt`);
    }
  }
  for (const spec of t.sections.filter((s) => s.mandatory)) {
    if (!pack.sections.some((s) => s.name === spec.name)) {
      t0ByteEqual = false;
      failures.push(`mandatory section ${spec.name} is empty`);
    }
  }
  const rendersConstraints = t.sections.some((s) => s.kinds.includes('active_constraint_set'));
  if (rendersConstraints && !pack.renderedUser.includes(input.activeConstraintSet.hardText)) {
    t0ByteEqual = false;
    failures.push('the Active Constraint Set hard block is not present byte-for-byte');
  }

  // Narrative Identity: block embedded in the SYSTEM position, hash matches, both contracts present.
  let identityOk = true;
  let bothContracts = true;
  if (t.validation.requireIdentityBlock || input.narrativeBlock) {
    const b = input.narrativeBlock;
    if (!b) {
      identityOk = false;
      bothContracts = false;
      failures.push(`template ${t.name} requires a Narrative Identity Block`);
    } else {
      if (!pack.renderedSystem.includes(b.text) || !b.text.startsWith(HEADER_PREFIX)) {
        identityOk = false;
        failures.push(
          'the Narrative Identity Block is not embedded verbatim in the system position',
        );
      }
      if (sha256(b.text) !== b.hash) {
        identityOk = false;
        failures.push('Narrative Identity Block hash does not match its bytes');
      }
      if (
        !b.outputLanguageContractHash ||
        !b.traditionContractHash ||
        !b.text.includes('## Output-Language Contract') ||
        !b.text.includes('## Narrative-Tradition Contract')
      ) {
        bothContracts = false;
        failures.push(
          'both Narrative Identity contracts (output language, tradition) must be present with hashes',
        );
      }
    }
  }

  // Active Constraint Set hash and pins.
  const acs = input.activeConstraintSet;
  const acsOk =
    sha256(acs.renderedText) === acs.contentHash && acs.renderedText.includes(acs.hardText);
  if (!acsOk) failures.push('Active Constraint Set content hash does not match its rendered bytes');

  // Previous chapter: accepted version pinned, tail bytes match the recorded slice.
  let prevOk = true;
  const prev = input.previousChapter;
  if (t.validation.requirePreviousChapter && input.contract.chapter_number > 1 && !prev) {
    prevOk = false;
    failures.push(
      `chapter ${input.contract.chapter_number} needs the accepted chapter ${input.contract.chapter_number - 1}`,
    );
  }
  if (prev) {
    const tailItem = pack.included.find(
      (i) => i.id === `prev_chapter_tail:${prev.manuscriptVersionId}`,
    );
    const m = pack.manifest.previous_chapter;
    if (!tailItem || !m) {
      if (t.validation.requirePreviousChapter) {
        prevOk = false;
        failures.push('previous chapter tail is missing from the pack');
      }
    } else {
      const chosenText =
        m.tail_hash === sha256(prev.tail.text)
          ? prev.tail.text
          : m.tail_hash === sha256(prev.tailFloor.text)
            ? prev.tailFloor.text
            : undefined;
      if (!chosenText || !pack.renderedUser.includes(chosenText)) {
        prevOk = false;
        failures.push('previous chapter tail hash does not match the accepted version slice');
      }
      if (
        m.manuscript_version_id !== prev.manuscriptVersionId ||
        m.accepted_canon_version !== prev.acceptedCanonVersion
      ) {
        prevOk = false;
        failures.push('previous chapter pins disagree with the accepted version');
      }
    }
  }

  // Sources: allowlisted, accepted-only, same project, pinned canon version and contract timeline.
  let sourcesOk = true;
  let noRejected = true;
  let projectOk = true;
  let pinsOk = true;
  for (const item of pack.included) {
    if (
      !t.allowedSources.includes(item.source.kind) ||
      t.prohibitedSources.includes(item.source.kind)
    ) {
      sourcesOk = false;
      failures.push(
        `item ${item.id} uses source ${item.source.kind} which ${t.name} does not allow`,
      );
    }
    const st = item.source.manuscript_status;
    if (st && st !== 'accepted') {
      const jobText =
        item.kind === 'chapter_text' &&
        item.source.kind === 'job_input' &&
        (t.chapterTextStatuses as readonly string[]).includes(st);
      if (!jobText) {
        noRejected = false;
        failures.push(`item ${item.id} cites a ${st} manuscript version`);
      }
    }
    if (item.source.project_id && item.source.project_id !== input.projectId) {
      projectOk = false;
      failures.push(`item ${item.id} belongs to project ${item.source.project_id}`);
    }
    if (CANON_KINDS.has(item.kind) && item.source.kind === 'canon') {
      if (item.source.version !== String(input.pins.canonVersion)) {
        pinsOk = false;
        failures.push(
          `item ${item.id} was read at canon version ${item.source.version ?? '?'}, pack pins ${input.pins.canonVersion}`,
        );
      }
      if (item.source.timeline_id && item.source.timeline_id !== input.contract.timeline_id) {
        pinsOk = false;
        failures.push(
          `item ${item.id} is on timeline ${item.source.timeline_id}, the contract is on ${input.contract.timeline_id}`,
        );
      }
    }
    if (item.provenance === 'untrusted_imported_text') {
      if (!t.validation.allowUntrusted) {
        sourcesOk = false;
        failures.push(`item ${item.id} is untrusted text, which ${t.name} forbids`);
      }
      const spec = t.sections.find((s) => s.name === item.section);
      if (spec?.position === 'system') {
        sourcesOk = false;
        failures.push(`untrusted item ${item.id} would be rendered in the system position`);
      }
    }
    if (
      (item.kind === 'plan' && item.provenance !== 'future_plan') ||
      (item.kind === 'contract' && item.provenance !== 'contract')
    ) {
      sourcesOk = false;
      failures.push(`plan item ${item.id} must be labeled as a plan`);
    }
  }

  const withinBudget = pack.manifest.token_counts.total <= pack.manifest.budget_tokens;
  if (!withinBudget) failures.push('rendered prompt exceeds the budget');

  // Pack hash: recompute from the manifest without its derived fields plus the rendered halves.
  const { pack_id: _id, pack_hash, validation: _v, ...rest } = pack.manifest;
  const recomputed = sha256(
    `${stableStringify(rest)}\u0000${pack.renderedSystem}\u0000${pack.renderedUser}`,
  );
  const hashOk = recomputed === pack_hash && pack.hash === pack_hash;
  if (!hashOk) failures.push('pack hash does not match the manifest and rendered bytes');

  const checks: ValidationChecks = {
    t0_byte_equal: t0ByteEqual,
    identity_block_hash_ok: identityOk,
    both_contracts_present: bothContracts,
    active_constraints_hash_ok: acsOk,
    prev_tail_hash_ok: prevOk,
    sources_allowlisted: sourcesOk,
    within_budget: withinBudget,
    pins_ok: pinsOk,
    pack_hash_ok: hashOk,
    no_rejected_sources: noRejected,
    project_scope_ok: projectOk,
    ...(failures.length ? { notes: failures } : {}),
  };
  return { ok: failures.length === 0, checks, failures };
}

export function assertValidPack(pack: ContextPack): ContextPack {
  if (!pack.validation.ok)
    throw new ContextError('PACK_VALIDATION_FAILED', pack.validation.failures.join('; '), {
      failures: pack.validation.failures,
    });
  return pack;
}
