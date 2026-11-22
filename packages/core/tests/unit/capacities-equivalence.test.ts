/**
 * Equivalencia con el panel externo de capacidades, sobre el espejo publicado real.
 *
 * Los literales salen de `CAP_DIAS=7 python3 ~/.hermes/swarm/bin/capacidades.py` (ventanas de 7 y 30 días),
 * corrido contra el espejo del 2026-11-22 (`.prdm/remote/docs`, 1367 documentos), con `now` fijo en
 * 2026-11-22T12:00:00Z. La fuente de verdad es la plataforma (`get_metrics.capacities`); el script queda
 * como verificación independiente.
 *
 * Si el espejo se refresca, hay que volver a medir con el script y actualizar los literales de abajo.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { computeCapacities, scanDocuments } from '@prdm/core';

const NOW = new Date('2026-11-22T12:00:00Z');

const candidates = [
  process.env.PRDM_MIRROR_DIR,
  path.resolve(process.cwd(), '.prdm/remote/docs'),
  path.resolve(process.cwd(), '../../.prdm/remote/docs'),
].filter((p): p is string => typeof p === 'string' && p !== '');
const mirror = candidates.find((p) => existsSync(p));

describe.skipIf(mirror === undefined)(
  'capacities equivalence with the external panel (checkout sin espejo: se saltea, no es un fallo del repo)',
  () => {
    const load = async () => {
      const scan = await scanDocuments(mirror as string, []);
      return computeCapacities(scan.docs, NOW);
    };
    const kinds = (counts: { kind: string; total: number }[]) => Object.fromEntries(counts.map((k) => [k.kind, k.total]));

    test('window 7: created by kind, features and feedback match the script', async () => {
      const w = (await load()).windows[0]!;
      expect(w.days).toBe(7);
      expect(kinds(w.createdByKind)).toEqual({ PRD: 0, FR: 7, SDD: 14, ADR: 0, WO: 40, BC: 1, FB: 59 });
      expect(w.features).toEqual([
        { kind: 'PRD', created: 0, withDesign: 0, withWorkOrders: 0, delivered: 0 },
        { kind: 'FR', created: 7, withDesign: 7, withWorkOrders: 7, delivered: 0 },
      ]);
      expect(w.feedback.created).toBe(59);
      expect(w.feedback.new + w.feedback.triaged + w.feedback.closed).toBe(w.feedback.created);
    });

    test('window 30: created by kind, features and feedback match the script', async () => {
      const w = (await load()).windows[1]!;
      expect(w.days).toBe(30);
      expect(kinds(w.createdByKind)).toEqual({ PRD: 0, FR: 7, SDD: 14, ADR: 0, WO: 40, BC: 1, FB: 62 });
      expect(w.features).toEqual([
        { kind: 'PRD', created: 0, withDesign: 0, withWorkOrders: 0, delivered: 0 },
        { kind: 'FR', created: 7, withDesign: 7, withWorkOrders: 7, delivered: 0 },
      ]);
      expect(w.feedback.created).toBe(62);
      expect(w.feedback.new + w.feedback.triaged + w.feedback.closed).toBe(w.feedback.created);
    });

    test('nothing delivered in either window (script: RESUMEN en curso=7)', async () => {
      const { windows } = await load();
      for (const w of windows) {
        expect(w.features.map((f) => f.delivered)).toEqual([0, 0]);
      }
    });
  },
);
