import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { doc } from '@prdm/testkit';
import { BC_REQUIRED_SECTIONS } from '../../src/domain/index.js';
import type { ParsedDoc } from '../../src/domain/schema.js';
import { checkLifecycle } from '../../src/lifecycle/check.js';
import { scanDocuments } from '../../src/parser/scan.js';

interface MirrorBaseline {
  measuredAt: string;
  mirror: string;
  documentsScanned: number;
  scanErrors: number;
  errorDocIds: string[];
  measuredWith: string;
}

const baseline: MirrorBaseline = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'fixtures/lifecycle-mirror-baseline.json'), 'utf8'),
) as MirrorBaseline;

const mirrorDir = process.env['PRDM_MIRROR_DIR'] ?? resolve(import.meta.dirname, '../../../../.prdm/remote/docs');
const mirrorExists = existsSync(mirrorDir);

const noGrandfathering = { grandfathered: [] };
const DOC_ID_PATTERN = /^[A-Z]+-\d+$/;

const BC_BODY = `${BC_REQUIRED_SECTIONS.join('\n\n')}\n`;
const approvedBc = (): ParsedDoc => doc('id: BC-001\ntype: BC\ntitle: Business case\nstatus: approved', BC_BODY);
// Legacy headings: none of the sections SDD-124 now requires.
const LEGACY_BODY = '## Contexto\n\nTexto viejo.\n\n## Detalle\n\nMás texto.\n';
const legacyPrd = (): ParsedDoc => doc('id: PRD-001\ntype: PRD\ntitle: Product\njustified_by: [BC-001]', LEGACY_BODY);
const legacyFr = (): ParsedDoc => doc('id: FR-001\ntype: FR\ntitle: Request\njustified_by: [BC-001]', LEGACY_BODY);

const errorsOf = (docs: ParsedDoc[], mode?: 'edit' | 'publish') =>
  checkLifecycle(docs, mode ? { ...noGrandfathering, mode } : noGrandfathering).filter((i) => i.severity === 'error');
const warningsOf = (docs: ParsedDoc[]) => checkLifecycle(docs, noGrandfathering).filter((i) => i.severity === 'warning');

describe('lifecycle grandfathering baseline', () => {
  test('la línea base del espejo está bien formada (WO-805)', () => {
    const ids = baseline.errorDocIds;
    expect(ids).toHaveLength(11);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
    for (const id of ids) expect(id).toMatch(DOC_ID_PATTERN);
    expect(baseline.documentsScanned).toBeGreaterThan(1000);
  });

  test.skipIf(!mirrorExists)('ningún documento publicado gana un error nuevo con las reglas de SDD-124 (WO-805)', async () => {
    const scan = await scanDocuments(mirrorDir, []);
    const errorIds = new Set(errorsOf(scan.docs).map((i) => i.nodeId));
    const known = new Set(baseline.errorDocIds);
    expect([...errorIds].filter((id) => !known.has(id))).toEqual([]);
    // A baseline id that vanished from the mirror means the fixture is stale: re-pin it by hand.
    const scanned = new Set(scan.ids);
    expect(baseline.errorDocIds.filter((id) => !scanned.has(id))).toEqual([]);
  });

  test('un PRD/FR legacy queda en advertencia por defecto y en error al publicar (WO-805)', () => {
    for (const legacy of [legacyPrd(), legacyFr()]) {
      const docs = [legacy, approvedBc()];
      const id = legacy.node.id;
      expect(errorsOf(docs).filter((i) => i.nodeId === id)).toEqual([]);
      expect(warningsOf(docs).filter((i) => i.nodeId === id).length).toBeGreaterThan(0);
      expect(errorsOf(docs, 'publish').filter((i) => i.nodeId === id).length).toBeGreaterThan(0);
    }
  });

  test('un documento grandfathered sigue exento en ambos modos (WO-805)', () => {
    for (const legacy of [legacyPrd(), legacyFr()]) {
      const ctx = { grandfathered: [{ id: legacy.node.id, hash: legacy.node.contentHash }] };
      for (const mode of ['edit', 'publish'] as const) {
        const issues = checkLifecycle([legacy, approvedBc()], { ...ctx, mode }).filter((i) => i.nodeId === legacy.node.id);
        expect(issues).toEqual([]);
      }
    }
  });
});
