import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@prdm/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      '@prdm/contracts': resolve(import.meta.dirname, 'packages/contracts/src/index.ts'),
      '@prdm/db': resolve(import.meta.dirname, 'packages/db/src/index.ts'),
      '@prdm/server': resolve(import.meta.dirname, 'packages/server/src/build-server.ts'),
      '@prdm/testkit': resolve(import.meta.dirname, 'packages/testkit/src/index.ts'),
    },
  },
  test: {
    // vitest 4 replaced `environmentMatchGlobs` with `projects`: one Node project for every package's
    // unit/integration suites, one jsdom project scoped to packages/web's client component tests.
    // Playwright E2E specs use the *.spec.ts convention and live under packages/web/tests/e2e, so they
    // never match either project's include and never compete with vitest for the same file.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/*/tests/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['packages/web/tests/client/**/*.test.tsx'],
          // Testing Library's cleanup() doesn't auto-run under Vitest (only under a Jest-like global test
          // framework), so it's wired in explicitly here; see packages/web/tests/client/setup.ts.
          setupFiles: ['packages/web/tests/client/setup.ts'],
          // Same reason as the top-level fileParallelism below: kept isolated per project.
          fileParallelism: false,
        },
      },
    ],
    // Integration and e2e suites share a single Neo4j instance and must run one file at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['packages/cli/src/index.ts', 'packages/mcp/src/server.ts', 'packages/web/src/server.ts', 'packages/web/src/client/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
