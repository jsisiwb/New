#!/usr/bin/env node
import { run } from './commands.js';

const result = run(process.argv.slice(2));
const text =
  typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2);
if (result.ok) {
  console.log(text);
} else {
  console.error(text);
  process.exitCode = 1;
}
