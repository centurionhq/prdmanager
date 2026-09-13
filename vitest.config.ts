import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@prdm/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      '@prdm/testkit': resolve(import.meta.dirname, 'packages/testkit/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    // Integration and e2e suites share a single Neo4j instance and must run one file at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/cli/src/index.ts', 'packages/mcp/src/server.ts'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
