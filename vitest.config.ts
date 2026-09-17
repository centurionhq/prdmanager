import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // SDD-008 §"Editor": Yjs is notoriously broken by even two "equivalent" copies of its own module ever
    // loading side-by-side (its own instanceof-based struct/type checks silently stop matching) — the
    // same reason ADR-006 requires `resolve.dedupe: ['yjs']` in packages/app's own vite.config.ts for the
    // browser build. Vitest resolves modules through Vite's own graph too (not plain Node `require`), so
    // the same defense-in-depth applies here for every package that imports yjs directly (collab, server,
    // app, and this config's own two-`HocuspocusProvider` tests, WO-159/166).
    dedupe: ['yjs'],
    alias: {
      // Subpath aliases MUST be listed before their bare-package alias below: vite's resolver does a prefix
      // match in declaration order, so `@prdm/core` (a prefix of `@prdm/core/domain`) would otherwise win first
      // and resolve `@prdm/core/domain` to the wrong file entirely (WO-129/SDD-007).
      '@prdm/core/domain': resolve(import.meta.dirname, 'packages/core/src/domain/index.ts'),
      '@prdm/mcp/lib': resolve(import.meta.dirname, 'packages/mcp/src/lib.ts'),
      '@prdm/core': resolve(import.meta.dirname, 'packages/core/src/index.ts'),
      '@prdm/contracts': resolve(import.meta.dirname, 'packages/contracts/src/index.ts'),
      '@prdm/collab': resolve(import.meta.dirname, 'packages/collab/src/index.ts'),
      '@prdm/db': resolve(import.meta.dirname, 'packages/db/src/index.ts'),
      '@prdm/server': resolve(import.meta.dirname, 'packages/server/src/build-server.ts'),
      '@prdm/testkit': resolve(import.meta.dirname, 'packages/testkit/src/index.ts'),
    },
  },
  test: {
    // vitest 4 replaced `environmentMatchGlobs` with `projects`. PRD-008 §4.1 / SDD-016 split them by whether a
    // suite needs a database, not just by environment: `unit-node` and `unit-jsdom` must pass with Docker down
    // (`npm run test:unit`, the only suites CI runs), `db` holds everything that talks to Neo4j/Postgres
    // (`npm run test:db`, run locally by the pre-push hook). Classification is by directory only, so a new test
    // lands on the right side by where it's created. Playwright specs use *.spec.ts and never match any project.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit-node',
          include: ['packages/*/tests/unit/**/*.test.ts', 'packages/*/tests/client/**/*.test.ts', 'packages/app/tests/collab/**/*.test.ts'],
          env: { PRDM_TEST_NO_DB: '1' },
          // Unlike unit-jsdom (Testing Library's global cleanup()) and db (a single shared Neo4j), this
          // project has no per-file shared state to serialize against, so it overrides the top-level
          // `fileParallelism: false` back on -- the whole point of PRD-008 §4.1 was to make this project
          // DB-free and fast, for both `npm run test:unit` (the only suite CI runs) and pre-commit.
          fileParallelism: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-jsdom',
          environment: 'jsdom',
          include: ['packages/*/tests/client/**/*.test.tsx'],
          env: { PRDM_TEST_NO_DB: '1' },
          // Testing Library's cleanup() doesn't auto-run under Vitest (only under a Jest-like global test
          // framework), so it's wired in explicitly here; see packages/web/tests/client/setup.ts.
          setupFiles: ['packages/web/tests/client/setup.ts'],
          // Same reason as the top-level fileParallelism below: kept isolated per project.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'db',
          include: ['packages/*/tests/{integration,e2e,collab,isolation,learning}/**/*.test.ts'],
          exclude: ['packages/app/tests/collab/**'],
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
      exclude: ['packages/cli/src/index.ts', 'packages/mcp/src/server.ts', 'packages/web/src/server.ts', 'packages/web/src/client/**', 'packages/app/src/**', 'packages/ui/src/**'],
      reporter: ['text-summary', 'text'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
