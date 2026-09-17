/**
 * Durable, machine-readable evidence for deterministic cost accounting (B-4-6).
 *
 * Its own file, for the reason recorded in the repaired chaos guard (D-4): every vitest invocation
 * rewrites `coverage/junit.xml`, so a guard that grepped it would only ever see the last suite that ran.
 *
 * The report states its own basis. `synthetic_replay` means the monetary values came from fixtures and
 * replay/mock providers — no live call, no invoice, no price table — which is the only basis this
 * repository can honestly produce today.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CostScenario {
  /** Machine-readable id, e.g. `COST-retry-then-success`. No prose. */
  readonly id: string;
  readonly outcome: 'passed' | 'failed';
  readonly invariants: readonly string[];
}

export function costReportPath(): string {
  return process.env.YEONJAE_COST_REPORT ?? 'coverage/cost-report.json';
}

const SECRET_SHAPED = [
  /\b(sk|pk)-[A-Za-z0-9]{8,}/,
  /bearer\s+[A-Za-z0-9._-]{12,}/i,
  /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/,
  /postgres(ql)?:\/\//,
];

export function recordCostScenarios(scenarios: readonly CostScenario[]): void {
  for (const s of scenarios) {
    const text = `${s.id} ${s.invariants.join(' ')}`;
    for (const pattern of SECRET_SHAPED) {
      if (pattern.test(text))
        throw new Error(`cost report refused: scenario ${s.id} carries secret-shaped content`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s.id))
      throw new Error(
        `cost report refused: scenario id ${JSON.stringify(s.id)} is not an identifier`,
      );
  }

  const path = costReportPath();
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { scenarios?: CostScenario[] })
    : {};
  const byId = new Map<string, CostScenario>(
    (existing.scenarios ?? []).map((s) => [s.id, s] as const),
  );
  for (const s of scenarios) byId.set(s.id, s);
  const merged = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  writeFileSync(
    path,
    `${JSON.stringify(
      {
        suite: 'B-4-6 deterministic cost and attempt accounting',
        // The evidence is synthetic by construction. Saying so in the artifact is what stops a reader
        // treating these cents as a bill.
        basis: 'synthetic_replay',
        live_provider_calls: 0,
        real_billing_calibrated: false,
        currency: 'USD',
        unit: 'cents',
        scenario_count: merged.length,
        scenarios: merged,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
