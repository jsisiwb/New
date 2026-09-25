/**
 * Bridge credit readings (ADR-0080). The Notion bridge's `/health` reports, per pooled workspace, how much
 * of its billing-period allowance and of its rolling window is used. Live runs record both before and
 * after, so every run's spend is on file even though the bridge prices no call.
 *
 * Only numbers leave this module: no URL, token, workspace name or id.
 */

export interface WorkspaceCredits {
  readonly index: number;
  /** Billing-period allowance used, in percent (the bridge reports it against a limit of 100). */
  readonly billing_used: number | null;
  readonly billing_limit: number | null;
  /** Rolling-window use and its label (e.g. `6h`). */
  readonly window_used: number | null;
  readonly window: string | null;
  readonly completed_requests: number | null;
  readonly failed_requests: number | null;
  readonly rate_limited: boolean | null;
}

export interface BridgeCredits {
  readonly at: string;
  readonly workspaces: readonly WorkspaceCredits[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parse a `/health` body into credit readings; unknown shapes yield no workspaces rather than a throw. */
export function parseBridgeHealth(body: unknown, at: Date = new Date()): BridgeCredits {
  const workspaces: WorkspaceCredits[] = [];
  const list = (body as { workspaces?: unknown } | null)?.workspaces;
  if (Array.isArray(list)) {
    for (const w of list as Record<string, unknown>[]) {
      const rl = (w.rate_limits ?? {}) as Record<string, Record<string, unknown> | undefined>;
      const bp = rl.billingPeriodWindow ?? {};
      const win = rl.window ?? {};
      workspaces.push({
        index: num(w.index) ?? workspaces.length + 1,
        billing_used: num(bp.used),
        billing_limit: num(bp.limit),
        window_used: num(win.used),
        window: typeof win.window === 'string' ? win.window : null,
        completed_requests: num(w.completed_requests),
        failed_requests: num(w.failed_requests),
        rate_limited: typeof w.rate_limited === 'boolean' ? w.rate_limited : null,
      });
    }
  }
  return { at: at.toISOString(), workspaces };
}

/** The bridge's health URL: the configured endpoint without its `/v1/complete` suffix, plus `/health`. */
export function bridgeHealthUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, '').replace(/\/v1\/complete$/, '')}/health`;
}

export async function readBridgeCredits(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<BridgeCredits> {
  const url = env.YEONJAE_NOTION_URL;
  if (!url) throw new Error('YEONJAE_NOTION_URL is not set');
  const res = await fetchImpl(bridgeHealthUrl(url), {
    headers: env.YEONJAE_NOTION_TOKEN
      ? { authorization: `Bearer ${env.YEONJAE_NOTION_TOKEN}` }
      : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`bridge health returned HTTP ${String(res.status)}`);
  return parseBridgeHealth(await res.json());
}

/** One line per reading, e.g. `ws1 billing 66.2% · 6h 0.6 · 160 done / 39 failed`. */
export function renderBridgeCredits(c: BridgeCredits): string {
  return c.workspaces
    .map(
      (w) =>
        `ws${String(w.index)} billing ${w.billing_used === null ? '?' : `${String(w.billing_used)}%`} · ${w.window ?? 'window'} ${w.window_used === null ? '?' : String(w.window_used)} · ${w.completed_requests === null ? '?' : String(w.completed_requests)} done / ${w.failed_requests === null ? '?' : String(w.failed_requests)} failed${w.rate_limited ? ' · rate-limited' : ''}`,
    )
    .join('\n');
}

/** Billing-period points used between two readings, per workspace and in total. */
export function creditDelta(
  before: BridgeCredits,
  after: BridgeCredits,
): {
  readonly per_workspace: readonly { index: number; points: number | null }[];
  readonly total: number;
} {
  const per = after.workspaces.map((w) => {
    const b = before.workspaces.find((x) => x.index === w.index);
    const points =
      b?.billing_used !== null && b?.billing_used !== undefined && w.billing_used !== null
        ? Math.round((w.billing_used - b.billing_used) * 100) / 100
        : null;
    return { index: w.index, points };
  });
  const total = Math.round(per.reduce((s, p) => s + (p.points ?? 0), 0) * 100) / 100;
  return { per_workspace: per, total };
}
