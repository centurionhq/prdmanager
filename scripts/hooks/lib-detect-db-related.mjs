#!/usr/bin/env node
/**
 * WO-408: prints the number of `db`-project vitest specs (each package's tests/{integration,e2e,collab,
 * isolation,learning} directory, per vitest.config.ts) that depend on the given files, without ever
 * executing a single test.
 *
 * `npx vitest related --run --project db <files>` looks like the obvious way to ask this, but it is NOT
 * a dry run: `related` filters specs by the module dependency graph and then hands whatever survives to
 * a real worker pool that imports and *runs* them. Verified empirically against this repo: pointed at a
 * source file with real `db`-project dependents, `vitest related --run --project db --passWithNoTests`
 * hung past a 20s timeout with zero output (the matched tests' `beforeAll` hooks trying to reach
 * Neo4j/Postgres) -- exactly the outcome `scripts/hooks/pre-commit` needs to avoid before
 * `test:services:check` (WO-401) has confirmed those are reachable.
 *
 * `getRelevantTestSpecifications()` runs the exact same dependency-graph filtering step `vitest related`
 * does internally (see `runRelated` / `TestSpecifications#filterTestsBySource` in vitest's own
 * `dist/chunks/cac.*.js` / `dist/chunks/cli-api.*.js`, vitest 4.1.11) but stops right there: it resolves
 * each candidate test file's import graph via Vite's `transformRequest`, which parses/transforms a
 * module to extract its imports without ever evaluating it, so no test file's module scope or hooks run.
 * This is the same codepath `vitest list --filesOnly` uses to list matching files without running them.
 *
 * `related` isn't part of vitest's public `UserConfig` type -- only the `related` CLI subcommand sets it
 * internally, from its own positional file arguments -- so passing it through `createVitest`'s options
 * here relies on that internal field rather than a documented API. Confirmed against vitest 4.1.11; if a
 * future vitest upgrade drops or renames it, this script will start silently reporting 0 db-related
 * specs for everything. `packages/server/tests/unit/pre-commit-hook.test.ts` doesn't invoke this file
 * (it would need a real vitest project graph to mean anything), so re-verify by hand after any vitest
 * minor/major bump -- e.g. re-run the two manual checks in this file's own WO-408 commit message.
 *
 * Usage: node scripts/hooks/lib-detect-db-related.mjs <file> [file...]
 * Prints a single integer (the match count) to stdout and exits 0 on success. Exits 1 with an error on
 * stderr if detection itself failed (e.g. a broken vitest config) -- the caller must treat that as a
 * hard failure, not as "0 related tests": silently skipping the db-services gate on an internal error
 * would defeat its entire purpose.
 */
import { createVitest } from 'vitest/node';

/** @param {string[]} files */
async function countRelatedDbSpecs(files) {
  if (files.length === 0) return 0;

  const ctx = await createVitest('test', {
    watch: false,
    run: true,
    passWithNoTests: true,
    project: ['db'],
    reporters: ['dot'],
    // See the header comment above: this is the same field `vitest related` sets from its CLI args.
    related: files,
  });
  try {
    const specs = await ctx.getRelevantTestSpecifications([]);
    return specs.length;
  } finally {
    await ctx.close();
  }
}

countRelatedDbSpecs(process.argv.slice(2))
  .then((count) => {
    console.log(count);
    process.exit(0);
  })
  .catch((err) => {
    console.error('lib-detect-db-related: failed to determine db-project relatedness:', err);
    process.exit(1);
  });
