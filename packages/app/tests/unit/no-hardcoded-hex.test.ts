import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDir = resolve(import.meta.dirname, '../../src/styles');
const allowed = new Set(['tokens.css']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * ADR-008 (ported from design/centurion-factory/tests/no-hardcoded-hex.test.ts): scoped to
 * `packages/app/src/styles` rather than the whole of `src` — this WO only ports the Centurion Factory
 * token sheet and CSS Modules that already build on it; components under `src/collab`, `src/routes`, etc.
 * still target `@prdm/ui`'s own token set until a later ADR-008 work order ports them too, so a literal
 * outside `styles/` there is a pre-existing, out-of-scope concern, not a regression this test should
 * flag.
 */
describe('no hardcoded hex colors in packages/app/src/styles', () => {
  const files = walk(stylesDir).filter((file) => file.endsWith('.css'));

  it('finds style files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('keeps hex values and rgb()/rgba() literals only inside tokens.css', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(stylesDir, file).split('\\').join('/');
      if (allowed.has(rel)) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        offenders.push(`${rel}: ${match[0]}`);
      }
      if (/rgba?\(\s*\d/.test(source)) offenders.push(`${rel}: rgb()/rgba() literal`);
    }
    expect(offenders).toEqual([]);
  });
});
