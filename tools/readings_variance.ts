import { createPool } from '@yeonjae/db';
import { measureVersionVariance } from '../packages/workflows/src/readings-variance.js';

const TARGET_VERSIONS = [
  '01a0dd28-a8ce-70d3-9321-49c2dee70837', // G21r v8
  '01a0dd36-4a3a-7165-b5a9-87a7e53395a6', // G22a v10
  '01a0dd58-3bc9-7d5b-a7a9-b9a2f3bd7fc9', // G23r v6
];

async function main() {
  const versionIds = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = versionIds.length > 0 ? versionIds : TARGET_VERSIONS;
  const pool = createPool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    const report = await measureVersionVariance(pool, targets);
    console.log(report.markdown);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
