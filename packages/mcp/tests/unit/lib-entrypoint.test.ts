import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const LIB_SRC = join(import.meta.dirname, '..', '..', 'src', 'lib.ts');

/**
 * WO-129/SDD-007: importing `@prdm/mcp/lib` must never run `main()` (connect to Neo4j, start listening on
 * stdio) as a side effect — unlike importing the root `.` export (`server.ts`), which does exactly that. Two
 * layers: a static check that `lib.ts` never reaches `server.ts` at all, and a dynamic check that actually
 * importing it resolves quickly with the expected exports (a real but self-caught `main()` failure would still
 * log to stderr and set `process.exitCode`, so the static check is the one that can't be fooled by that).
 */
describe('@prdm/mcp/lib entrypoint', () => {
  test('never imports server.ts (the only place main() is invoked)', () => {
    const src = readFileSync(LIB_SRC, 'utf8');
    expect(src).not.toMatch(/from\s+['"]\.\/server\.js['"]/);
  });

  test('importing it resolves without running main() and exposes the documented API', async () => {
    const originalExitCode = process.exitCode;
    const lib = await import('../../src/lib.js');
    expect(typeof lib.createPrdmServer).toBe('function');
    expect(typeof lib.registerPrdmTools).toBe('function');
    expect(typeof lib.fenceTag).toBe('function');
    expect(typeof lib.escapeFenceChars).toBe('function');
    expect(typeof lib.requireAuthoring).toBe('function');
    // main() sets process.exitCode = 1 on failure (e.g. no reachable Neo4j); merely importing lib.ts must never trigger that.
    expect(process.exitCode).toBe(originalExitCode);
  });

  test('fenceTag/escapeFenceChars behave as documented once imported from the lib entrypoint', async () => {
    const { escapeFenceChars, fenceTag } = await import('../../src/lib.js');
    expect(fenceTag('project_context')).toMatch(/^project_context_[0-9a-f]+$/);
    expect(escapeFenceChars('<script>')).toBe('\\u003cscript\\u003e');
  });
});
