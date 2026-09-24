/**
 * `pnpm policy:rehash [--check]` — recompute the canonical content hash of every Production Policy
 * (ADR-0041) in examples/production-policies (R2, ADR-0071).
 *
 * `--check` (CI and `pnpm check`) lists every file whose `content_hash` is stale and exits 1. A stale hash
 * crashes every process that loads the policies (`loadPolicies`), which is how an ADR renumbering that
 * edited a policy's `name` reached a live run before any test ran.
 *
 * Without `--check` the tool rewrites stale hashes in place, touching only the hash string. It refuses a
 * file whose semantic content (everything but `name`, `notes` and `content_hash`) differs from the
 * committed version: a pinned policy is never mutated (ADR-0041); a new behaviour is a new version.
 * `--allow-semantic` overrides the refusal for a policy version that has not been published yet.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { canonicalPolicyHash } from '../packages/domain/src/policy.js';
import { type ProductionPolicy } from '../packages/domain/src/generated/production-policy.js';

const ROOT = resolve(import.meta.dirname, '..');
const DIR = join(ROOT, 'examples', 'production-policies');
const DESCRIPTIVE = new Set(['name', 'notes', 'content_hash']);

function semantic(policy: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(policy)
        .filter((k) => !DESCRIPTIVE.has(k))
        .sort()
        .map((k) => [k, policy[k]]),
    ),
  );
}

function committed(path: string): Record<string, unknown> | undefined {
  const res = spawnSync('git', ['show', `HEAD:${relative(ROOT, path)}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (res.status !== 0) return undefined;
  return JSON.parse(res.stdout) as Record<string, unknown>;
}

const args = new Set(process.argv.slice(2));
const check = args.has('--check');
const allowSemantic = args.has('--allow-semantic');

let stale = 0;
let refused = 0;
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();
for (const f of files) {
  const path = join(DIR, f);
  const raw = readFileSync(path, 'utf8');
  const policy = JSON.parse(raw) as ProductionPolicy & Record<string, unknown>;
  const expected = canonicalPolicyHash(policy);
  if (policy.content_hash === expected) continue;
  stale += 1;
  if (check) {
    console.error(`stale: ${f} has ${policy.content_hash}, canonical ${expected}`);
    continue;
  }
  const before = committed(path);
  if (before && semantic(before) !== semantic(policy) && !allowSemantic) {
    refused += 1;
    console.error(
      `refused: ${f} changed more than its name/notes since HEAD; a pinned policy is never mutated — ` +
        'add a new version (or pass --allow-semantic for an unpublished one)',
    );
    continue;
  }
  const next = raw.replace(
    /("content_hash"\s*:\s*")[^"]*(")/,
    (_m, a: string, b: string) => `${a}${expected}${b}`,
  );
  writeFileSync(path, next);
  console.log(`rehashed: ${f}`);
}

if (check && stale > 0) {
  console.error(
    `${String(stale)} of ${String(files.length)} policies have stale content hashes; run pnpm policy:rehash`,
  );
  process.exit(1);
}
if (refused > 0) process.exit(1);
console.log(
  check
    ? `policy hashes fresh: ${String(files.length)} policies`
    : `${String(stale)} of ${String(files.length)} policies rehashed`,
);
