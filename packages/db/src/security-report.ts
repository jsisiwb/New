/**
 * Durable, machine-readable evidence for the defensive security suite (B-4-4).
 *
 * Its own file, for the reason recorded in `restore-report.ts` and in the repaired chaos guard (D-4):
 * every vitest invocation rewrites `coverage/junit.xml`, so a CI guard that grepped it would only ever
 * see the last suite that ran.
 *
 * Writing is append-and-merge, because the suite spans several files that vitest may run in any order or
 * in separate processes. Re-recording the same id is idempotent, so a retried suite cannot inflate the
 * scenario count.
 *
 * The report carries scenario ids, boundary labels and outcomes. It never carries prose, prompts,
 * manuscript text or credentials, and `recordSecurityScenarios` refuses rather than trusting its callers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The boundary families B-4-4 requires coverage of. A scenario declares which one it defends. */
export const SECURITY_SURFACES = [
  'authentication',
  'authorization',
  'rls',
  'input_output',
  'http_stream',
  'jobs_gateway',
  'rate_limit',
  'telemetry',
  'supply_chain',
] as const;
export type SecuritySurface = (typeof SECURITY_SURFACES)[number];

export interface SecurityScenario {
  /** Machine-readable id, e.g. `AUTHZ-cross-workspace-id`. No prose. */
  readonly id: string;
  readonly outcome: 'passed' | 'failed';
  readonly surface: SecuritySurface;
  /** Short invariant labels, e.g. `denies_cross_tenant_read`. No prose. */
  readonly invariants: readonly string[];
}

export function securityReportPath(): string {
  return process.env.YEONJAE_SECURITY_REPORT ?? 'coverage/security-report.json';
}

const SECRET_SHAPED = [
  /\b(sk|pk)-[A-Za-z0-9]{8,}/,
  /bearer\s+[A-Za-z0-9._-]{12,}/i,
  /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/,
  /postgres(ql)?:\/\//,
];

export function recordSecurityScenarios(scenarios: readonly SecurityScenario[]): void {
  for (const s of scenarios) {
    const text = `${s.id} ${s.invariants.join(' ')}`;
    for (const pattern of SECRET_SHAPED) {
      if (pattern.test(text))
        throw new Error(`security report refused: scenario ${s.id} carries secret-shaped content`);
    }
    // An id is an identifier, not free text: machine-safe and prose-free by construction.
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s.id))
      throw new Error(
        `security report refused: scenario id ${JSON.stringify(s.id)} is not an identifier`,
      );
  }

  const path = securityReportPath();
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { scenarios?: SecurityScenario[] })
    : {};
  const byId = new Map<string, SecurityScenario>(
    (existing.scenarios ?? []).map((s) => [s.id, s] as const),
  );
  for (const s of scenarios) byId.set(s.id, s);
  const merged = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bySurface: Record<string, number> = {};
  for (const s of merged) bySurface[s.surface] = (bySurface[s.surface] ?? 0) + 1;

  writeFileSync(
    path,
    `${JSON.stringify(
      {
        suite: 'B-4-4 defensive application security boundaries',
        defensive_only: true,
        live_provider_calls: 0,
        scenario_count: merged.length,
        by_surface: bySurface,
        scenarios: merged,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
