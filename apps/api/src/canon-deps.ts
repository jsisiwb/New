/**
 * The canon-service surface the API is allowed to reach.
 *
 * A single re-export point exists so the HTTP layer's dependency on the domain is explicit and reviewable:
 * anything the API can call for canon operations is named here, which makes it obvious in review when a
 * route starts reaching for something new. It also keeps `canon-ops.ts` free of deep import paths.
 */
export {
  correctCanonItem,
  CorrectionError,
  regenerationPreview,
  retconCanonItem,
  rollbackLatestCommit,
  type CanonItemKind,
  type CorrectionResult,
  type ImpactReport,
} from '@yeonjae/canon';
export { type Pool } from '@yeonjae/db';
