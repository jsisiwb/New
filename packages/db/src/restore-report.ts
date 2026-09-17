/**
 * Durable, machine-readable evidence for the restore drill (B-4-3).
 *
 * The report lives in its own file rather than in `coverage/junit.xml`, because every vitest invocation
 * rewrites junit.xml — a CI guard that grepped it would only ever see the last suite that ran. That is
 * exactly how the B-4-2 chaos guard first failed (defect D-4); this follows the repaired pattern.
 *
 * The report carries identifiers, counts, checksums and outcomes. It never carries prose, prompts,
 * manuscript text, connection URLs or credentials — `writeRestoreDrillReport` refuses rather than
 * trusting its caller.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RestoreDrillReport } from './restore-drill.js';

export function restoreReportPath(): string {
  return process.env.YEONJAE_RESTORE_REPORT ?? 'coverage/restore-drill-report.json';
}

const FORBIDDEN = [
  [/\b(sk|pk)-[A-Za-z0-9]{8,}/, 'an API-key-shaped string'],
  [/bearer\s+[A-Za-z0-9._-]{12,}/i, 'a bearer token'],
  [/BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/, 'a private key block'],
  [/postgres(ql)?:\/\//, 'a connection URL'],
] as const;

export function writeRestoreDrillReport(report: RestoreDrillReport): string {
  const serialized = JSON.stringify(report, null, 2);
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(serialized)) throw new Error(`restore report refused: it contains ${label}`);
  }
  for (const invariant of report.invariants) {
    if (!/^[a-z0-9_]+$/.test(invariant.id))
      throw new Error(
        `restore report refused: invariant id ${JSON.stringify(invariant.id)} is not an identifier`,
      );
  }
  const path = restoreReportPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${serialized}\n`, 'utf8');
  return path;
}
