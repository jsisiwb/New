/**
 * `buildPack`: fetch → assemble → validate → (optionally) persist the manifest. This is the one entry point
 * workflows and the CLI use; the returned pack carries everything the gateway needs (`renderedSystem`,
 * `renderedUser`, `hash`, `narrativeIdentityRef`) plus the manifest for the audit row.
 */
import { storeActiveConstraintSet, storeContextPack, type Client, type Pool } from '@yeonjae/db';
import { assemblePack, type ContextPack } from './assemble.js';
import { fetchContext, type FetchOptions, type FetchResult } from './fetch.js';
import { assertValidPack } from './validate.js';

export interface BuildResult {
  readonly pack: ContextPack;
  readonly fetch: FetchResult;
  readonly stored: boolean;
}

export async function buildPack(
  db: Pool | Client,
  opts: FetchOptions & { readonly persist?: boolean | undefined },
): Promise<BuildResult> {
  const fetch = await fetchContext(db, opts);
  const pack = assertValidPack(assemblePack(fetch.input, { budgetTokens: opts.budgetTokens }));
  let stored = false;
  if (opts.persist) {
    await storeActiveConstraintSet(db, {
      id: fetch.constraints.id,
      workspaceId: fetch.input.workspaceId,
      projectId: opts.projectId,
      chapterNo: fetch.constraints.chapterNo,
      specVersion: fetch.constraints.specVersion,
      contentHash: fetch.constraints.contentHash,
      renderedText: fetch.constraints.renderedText,
      itemIds: fetch.constraints.itemIds,
      tokenCount: fetch.constraints.tokenCount,
      hardCount: fetch.constraints.hard.length,
    });
    const r = await storeContextPack(db, {
      id: pack.id,
      workspaceId: fetch.input.workspaceId,
      projectId: opts.projectId,
      jobId: opts.jobId,
      template: pack.template.name,
      templateVersion: pack.manifest.template_version,
      role: opts.role,
      canonVersion: fetch.input.pins.canonVersion,
      packHash: pack.hash,
      manifest: pack.manifest,
      tokenCounts: pack.manifest.token_counts,
      renderedSystemHash: pack.manifest.rendered_system_hash ?? '',
      renderedUserHash: pack.manifest.rendered_user_hash ?? '',
      degraded: pack.manifest.degraded ?? false,
    });
    stored = r.stored;
  }
  return { pack, fetch, stored };
}
