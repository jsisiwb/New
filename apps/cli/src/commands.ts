/**
 * CLI commands available in Checkpoint 1. Each command is a pure function over its inputs so it can be unit
 * tested without a TTY; main.ts only parses argv and prints. Later checkpoints add project/chapter commands.
 */
import { readFileSync } from 'node:fs';
import {
  checkOutputLanguage,
  measure,
  toNfcText,
  verifyEvidence,
  segmentParagraphs,
} from '@yeonjae/prose';
import { loadPolicies, loadSchemas, validatorFor } from '@yeonjae/domain';

export interface CommandResult {
  readonly ok: boolean;
  readonly output: unknown;
}

export function cmdMeasure(path: string): CommandResult {
  const nfc = toNfcText(readFileSync(path, 'utf8'));
  return { ok: true, output: measure(nfc) };
}

export function cmdLanguageCheck(path: string, allowlist: readonly string[] = []): CommandResult {
  const nfc = toNfcText(readFileSync(path, 'utf8'));
  const r = checkOutputLanguage(nfc, { allowlist });
  return { ok: r.passed, output: r };
}

export function cmdValidate(schemaFile: string, instancePath: string): CommandResult {
  const instance = JSON.parse(readFileSync(instancePath, 'utf8')) as unknown;
  const r = validatorFor(schemaFile)(instance);
  return r.ok
    ? { ok: true, output: { valid: true, schema: schemaFile } }
    : { ok: false, output: { valid: false, errors: r.errors } };
}

export function cmdVerifyEvidence(manuscriptPath: string, deltaPath: string): CommandResult {
  const nfc = toNfcText(readFileSync(manuscriptPath, 'utf8'));
  const paragraphs = segmentParagraphs(nfc);
  const delta = JSON.parse(readFileSync(deltaPath, 'utf8')) as {
    items: {
      local_id: string;
      evidence: {
        start: number;
        end: number;
        quote: string;
        quote_hash?: string;
        paragraph_id?: string;
      }[];
    }[];
  };
  const results = delta.items.flatMap((item) =>
    item.evidence.map((ev, i) => {
      const verdict = verifyEvidence(nfc, {
        start: ev.start,
        end: ev.end,
        quote: ev.quote,
        quoteHash: ev.quote_hash,
      });
      const para = paragraphs.find((p) => p.start <= ev.start && ev.start < p.end);
      const paragraphOk = ev.paragraph_id === undefined || para?.id === ev.paragraph_id;
      return { item: item.local_id, evidence: i, verdict, paragraph_ok: paragraphOk };
    }),
  );
  const ok = results.every((r) => r.verdict.ok && r.paragraph_ok);
  return {
    ok,
    output: {
      checked: results.length,
      ok,
      failures: results.filter((r) => !r.verdict.ok || !r.paragraph_ok),
    },
  };
}

export function cmdPolicies(): CommandResult {
  const policies = loadPolicies();
  return {
    ok: true,
    output: [...policies.entries()].map(([ref, p]) => ({
      ref,
      tier: p.quality_tier,
      max_revision_rounds: p.revision.max_rounds,
      gates: Object.fromEntries(
        Object.entries(p.gates.dimensions).map(([k, v]) => [k, v.min_score]),
      ),
      calibration: p.calibration.status,
    })),
  };
}

export function cmdSchemas(): CommandResult {
  const { schemas } = loadSchemas();
  return { ok: true, output: [...schemas.keys()] };
}

export const USAGE = `yeonjae <command> [args]

  schemas                              list loaded JSON Schemas
  validate <schema-file> <json>        validate a JSON instance against schemas/<schema-file>
  measure <text-file>                  length model (words, code points, paragraphs, sentences, est. tokens)
  language-check <text-file> [terms…]  deterministic English output-language check (allowlist terms optional)
  verify-evidence <manuscript> <delta> verify every evidence span of a canon delta against the NFC manuscript
  policies                             list Production Policy versions and their per-dimension gates
`;

export function run(argv: readonly string[]): CommandResult {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'schemas':
      return cmdSchemas();
    case 'validate': {
      const [schema, file] = rest;
      if (!schema || !file) return { ok: false, output: USAGE };
      return cmdValidate(schema, file);
    }
    case 'measure': {
      const [file] = rest;
      if (!file) return { ok: false, output: USAGE };
      return cmdMeasure(file);
    }
    case 'language-check': {
      const [file, ...terms] = rest;
      if (!file) return { ok: false, output: USAGE };
      return cmdLanguageCheck(file, terms);
    }
    case 'verify-evidence': {
      const [manuscript, delta] = rest;
      if (!manuscript || !delta) return { ok: false, output: USAGE };
      return cmdVerifyEvidence(manuscript, delta);
    }
    case 'policies':
      return cmdPolicies();
    default:
      return { ok: false, output: USAGE };
  }
}
