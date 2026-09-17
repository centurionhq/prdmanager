#!/usr/bin/env node
/**
 * PRD-008 §4.1d (WO-400): verifies that every test file in the repo belongs to exactly one Vitest
 * project (`unit-node`, `unit-jsdom`, `db`, as defined in `vitest.config.ts`). A file matching zero
 * projects would silently never run in either `npm run test:unit` or `npm run test:db`; a file matching
 * more than one would run twice, double-counting toward the total. Both are errors here.
 *
 * Rather than re-implementing `vitest.config.ts`'s own `include`/`exclude` globs a second time (which
 * would drift the moment the config changes), this asks Vitest itself which files each project would
 * run (`vitest list --project <name> --json`) and cross-references that against a plain filesystem scan
 * of every package's tests directory (test.{ts,tsx} files only) — the same base set every project's
 * `include` narrows from. `.spec.ts` (Playwright) files are excluded from the filesystem scan for the
 * same reason PRD-008 §4.1 excludes them from every project: they're a different runner entirely, not a
 * gap.
 *
 * Usage: node scripts/check-test-projects.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import fg from 'fast-glob';

const ROOT = resolve(import.meta.dirname, '..');
const PROJECTS = ['unit-node', 'unit-jsdom', 'db'];

function listProjectFiles(project) {
  // `vitest list --json` (streamed to stdout) never exits cleanly in this repo's setup; writing to a
  // file with `--json=<path>` (vitest's own documented alternative) does.
  const dir = mkdtempSync(join(tmpdir(), 'prdm-check-test-projects-'));
  const outFile = join(dir, 'list.json');
  try {
    execFileSync('npx', ['vitest', 'list', '--project', project, `--json=${outFile}`], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const entries = JSON.parse(readFileSync(outFile, 'utf8'));
    return new Set(entries.map((entry) => resolve(entry.file)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const allTestFiles = await fg('packages/*/tests/**/*.test.{ts,tsx}', { cwd: ROOT, absolute: true });
  const byFile = new Map(allTestFiles.map((file) => [resolve(file), []]));

  for (const project of PROJECTS) {
    for (const file of listProjectFiles(project)) {
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(project);
    }
  }

  const orphaned = [];
  const duplicated = [];
  for (const [file, projects] of byFile) {
    const relative = file.slice(ROOT.length + 1);
    if (projects.length === 0) orphaned.push(relative);
    else if (projects.length > 1) duplicated.push(`${relative} (${projects.join(', ')})`);
  }

  if (orphaned.length === 0 && duplicated.length === 0) {
    console.log(`check-test-projects: ${byFile.size} test files, each in exactly one Vitest project.`);
    return;
  }

  if (orphaned.length > 0) {
    console.error(`check-test-projects: ${orphaned.length} test file(s) belong to no Vitest project (never run by test:unit or test:db):`);
    for (const file of orphaned) console.error(`  - ${file}`);
  }
  if (duplicated.length > 0) {
    console.error(`check-test-projects: ${duplicated.length} test file(s) belong to more than one Vitest project (run twice):`);
    for (const file of duplicated) console.error(`  - ${file}`);
  }
  process.exitCode = 1;
}

await main();
