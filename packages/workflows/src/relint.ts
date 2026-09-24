/**
 * The Korean lint re-run over a project's ACCEPTED chapters, optionally under another language layer
 * (e.g. `lang/ko@5` for a project pinned to `lang/ko@4`). A calibration aid: the thresholds are starting
 * values (ADR-0062, ADR-0065) and live chapters are the evidence for moving them. Deterministic; no model
 * call, nothing written.
 */
import { type Pool } from '@yeonjae/db';
import { composeIdentity, exemplarsOf, ProfileStore } from '@yeonjae/narrative';
import { lintKoreanWebnovel, type KoStyleReport } from '@yeonjae/prose';
import { loadIntoStore } from './identity-from-intake.js';

export interface RelintChapter {
  readonly number: number;
  readonly characters: number;
  /** rule id → findings, with the worst severity. */
  readonly rules: Readonly<Record<string, { readonly count: number; readonly worst: string }>>;
  readonly metrics: KoStyleReport['metrics'];
}

export interface RelintReport {
  readonly project_id: string;
  readonly layer: string;
  readonly chapters: readonly RelintChapter[];
}

export async function relintAccepted(
  pool: Pool,
  projectId: string,
  opts: { readonly layer?: string | undefined; readonly chapter?: number | undefined } = {},
): Promise<RelintReport> {
  const store = ProfileStore.fromDirectory();
  await loadIntoStore(pool, projectId, store);
  const project = await pool.query<{ settings: Record<string, unknown> }>(
    'SELECT settings FROM projects WHERE id = $1',
    [projectId],
  );
  const settings = project.rows[0]?.settings ?? {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  let ref = str(settings.narrative_identity_ref);
  const versionId = str(settings.narrative_identity_version_id);
  if (!ref) throw new Error(`project ${projectId} pins no narrative identity`);
  const pinned = store.get(ref);
  if (opts.layer && opts.layer !== pinned.lineage?.output_language) {
    // A throwaway composed profile that differs from the pinned one only in its language layer.
    const variant = {
      ...pinned,
      id: `${pinned.id}-relint`,
      lineage: { ...pinned.lineage, output_language: opts.layer },
    };
    store.add(variant);
    ref = `${variant.id}@${String(variant.version)}`;
  }
  const identity = composeIdentity(store, ref, versionId);
  const layer = store.get(ref).lineage?.output_language ?? '';
  const entities = await pool.query<{
    type: string;
    display_name: string;
    short_forms: string[] | null;
    aliases: string[] | null;
  }>(
    "SELECT type, display_name, short_forms, aliases FROM entities WHERE project_id = $1 AND status <> 'merged_into'",
    [projectId],
  );
  const namesOf = (rows: typeof entities.rows) =>
    rows.flatMap((e) => [e.display_name, ...(e.short_forms ?? []), ...(e.aliases ?? [])]);
  const allowlist = namesOf(entities.rows);
  const personNames = namesOf(entities.rows.filter((e) => e.type === 'character'));
  const displayNames = entities.rows
    .filter((e) => e.type === 'character')
    .map((e) => e.display_name);
  const chapters = await pool.query<{ number: number; text: string }>(
    `SELECT c.number, v.text FROM chapters c JOIN manuscript_versions v ON v.id = c.accepted_version_id
      WHERE c.project_id = $1 AND ($2::int IS NULL OR c.number = $2) ORDER BY c.number`,
    [projectId, opts.chapter ?? null],
  );
  const ol = identity.outputLanguage;
  return {
    project_id: projectId,
    layer,
    chapters: chapters.rows.map((c) => {
      const report = lintKoreanWebnovel(c.text, {
        translationMarkers: ol.translation_markers,
        forbiddenPatterns: ol.forbidden_patterns,
        thresholds: ol.lint_thresholds,
        calquePhrases: ol.calque_phrases,
        pov: identity.preferences?.pov,
        displayNames,
        allowlist,
        exemplarTexts: exemplarsOf(identity).map((e) => e.text),
        personNames,
      });
      const rules: Record<string, { count: number; worst: string }> = {};
      for (const f of report.findings) {
        const prev = rules[f.rule_id];
        rules[f.rule_id] = {
          count: (prev?.count ?? 0) + 1,
          worst: prev?.worst === 'major' || f.severity === 'major' ? 'major' : f.severity,
        };
      }
      return {
        number: c.number,
        characters: report.metrics.characters,
        rules,
        metrics: report.metrics,
      };
    }),
  };
}
