#!/usr/bin/env node
import { DB_COMMANDS, run, runDb, runProviderCheck } from './commands.js';

const argv = process.argv.slice(2);
const result =
  argv[0] === 'provider:check'
    ? await runProviderCheck(argv.slice(1))
    : DB_COMMANDS.has(argv[0] ?? '')
      ? await runDb(argv)
      : run(argv);
const text =
  typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 2);
if (result.ok) {
  console.log(text);
} else {
  console.error(text);
  process.exitCode = 1;
}
