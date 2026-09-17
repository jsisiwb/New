/**
 * Machine-readable chaos-report accumulator (B-4-2).
 *
 * Deterministic chaos suites record one entry per scenario here; the last suite to finish writes the
 * merged report to `YEONJAE_CHAOS_REPORT` (default `coverage/chaos-report.json`), which
 * `tools/run-chaos-drills.mjs` then verifies. Writing is append-and-merge rather than truncate, because
 * the matrix spans several suites and vitest may run them in any order or in separate processes.
 *
 * The report is published evidence. It carries scenario ids, outcomes and the invariant labels each
 * scenario covers — never manuscript prose, prompts, provider payloads or credentials. `record` rejects a
 * secret-shaped value rather than trusting its callers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ChaosScenario {
  readonly id: string;
  readonly outcome: 'passed' | 'failed';
  /** Short invariant labels, e.g. `fallback_only_when_retryable`. No prose. */
  readonly invariants: readonly string[];
  readonly surface: 'gateway' | 'workflow' | 'database';
}

export function chaosReportPath(): string {
  return process.env.YEONJAE_CHAOS_REPORT ?? 'coverage/chaos-report.json';
}

const SECRET_SHAPED = [
  /\b(sk|pk)-[A-Za-z0-9]{8,}/,
  /bearer\s+[A-Za-z0-9._-]{12,}/i,
  /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/,
];

/**
 * Merge `scenarios` into the report on disk. Re-recording the same id is idempotent (the newest outcome
 * wins), so a retried suite cannot inflate the scenario count.
 */
export function recordChaosScenarios(scenarios: readonly ChaosScenario[]): void {
  for (const s of scenarios) {
    const text = `${s.id} ${s.invariants.join(' ')}`;
    for (const pattern of SECRET_SHAPED) {
      if (pattern.test(text))
        throw new Error(`chaos report refused: scenario ${s.id} carries secret-shaped content`);
    }
    // A scenario id is an identifier, not free text: keep it machine-safe and prose-free by construction.
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s.id))
      throw new Error(
        `chaos report refused: scenario id ${JSON.stringify(s.id)} is not an identifier`,
      );
  }

  const path = chaosReportPath();
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { scenarios?: ChaosScenario[] })
    : {};
  const byId = new Map<string, ChaosScenario>(
    (existing.scenarios ?? []).map((s) => [s.id, s] as const),
  );
  for (const s of scenarios) byId.set(s.id, s);
  const merged = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        suite: 'B-4-2 deterministic chaos and provider-fallback drills',
        deterministic: true,
        live_provider_calls: 0,
        scenario_count: merged.length,
        scenarios: merged,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}
