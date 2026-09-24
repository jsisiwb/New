/**
 * Render a family's output-shape example from its answer schema (ADR-0057) for the Python prompt
 * generators: `tsx tools/render-shape.ts <family>` reads the base example (JSON) on stdin and prints
 * `{ "example": …, "notes": [...], "workflow_filled": [...] }`.
 */
import { readFileSync } from 'node:fs';
import { OUTPUT_SHAPES, modelAnswerSchema, renderShape } from '../packages/prompts/src/index.js';

const family = process.argv[2] ?? '';
const schema = modelAnswerSchema(family);
if (!schema) {
  process.stderr.write(`no answer schema for ${family}\n`);
  process.exit(2);
}
const base = JSON.parse(readFileSync(0, 'utf8') || 'null') as unknown;
const { example, notes } = renderShape(schema, base);
process.stdout.write(
  JSON.stringify({ example, notes, workflow_filled: OUTPUT_SHAPES[family]?.workflowFilled ?? [] }),
);
