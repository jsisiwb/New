/**
 * Production Policy loading and pinning (ADR-0041). Policies are data in examples/production-policies until a
 * database exists; every job pins `policy/<tier>@<version>` and reads limits from the pinned object only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertValid } from './schemas.js';
import { type ProductionPolicy } from './generated/production-policy.js';

export type QualityTier = 'economy' | 'standard' | 'premium';
export type PolicyRef = `policy/${QualityTier}@${number}`;

function policiesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'examples', 'production-policies');
}

export function canonicalPolicyHash(policy: ProductionPolicy): string {
  const { content_hash: _omit, ...rest } = policy;
  const sorted = JSON.stringify(sortKeys(rest));
  return `sha256:${createHash('sha256').update(sorted, 'utf8').digest('hex')}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function loadPolicies(dir: string = policiesDir()): Map<PolicyRef, ProductionPolicy> {
  const out = new Map<PolicyRef, ProductionPolicy>();
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
    const policy = assertValid<ProductionPolicy>('production-policy.schema.json', raw, f);
    const expected = canonicalPolicyHash(policy);
    if (policy.content_hash !== expected) {
      throw new Error(
        `${f}: content_hash ${policy.content_hash} does not match canonical ${expected}`,
      );
    }
    out.set(`${policy.id}@${policy.version}` as PolicyRef, policy);
  }
  return out;
}

export function policyRef(policy: ProductionPolicy): PolicyRef {
  return `${policy.id}@${policy.version}` as PolicyRef;
}

export function requirePolicy(
  ref: PolicyRef,
  policies: Map<PolicyRef, ProductionPolicy> = loadPolicies(),
): ProductionPolicy {
  const p = policies.get(ref);
  if (!p)
    throw new Error(`unknown production policy ${ref}; known: ${[...policies.keys()].join(', ')}`);
  return p;
}

export type OverrideClass = 'never' | 'canon_workflow' | 'reviewer' | 'advisory';

/** Resolve the override class for an issue kind + severity from the pinned policy (ADR-0042). */
export function overrideClassFor(
  policy: ProductionPolicy,
  kind: string,
  severity: 'blocking' | 'major' | 'minor' | 'note',
): OverrideClass {
  const m = policy.override_matrix;
  for (const esc of m.project_escalations ?? []) if (esc.kind === kind) return esc.class;
  if (m.never.includes(kind)) return 'never';
  if (m.canon_workflow.includes(kind)) return 'canon_workflow';
  if (severity === 'minor' || severity === 'note') return 'advisory';
  return 'reviewer';
}
