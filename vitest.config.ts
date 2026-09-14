import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    // DB integration tests run serially against one database; unit tests are unaffected.
    fileParallelism: false,
    testTimeout: 20_000,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: process.env.CI ? { junit: 'coverage/junit.xml' } : undefined,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'packages/domain/src/generated/**'],
    },
  },
});
