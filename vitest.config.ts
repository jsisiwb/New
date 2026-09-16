import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      // The web app's tests are .tsx (they render components) and declare `@vitest-environment jsdom`
      // per file, so the Node default below still applies to every server-side suite.
      'apps/*/src/**/*.test.tsx',
      'tools/**/*.test.ts',
    ],
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
