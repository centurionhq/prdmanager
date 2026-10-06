/**
 * The demo's one and only «ahora» (WO-674).
 *
 * Every screen of this mock package is written against a single frozen instant, so no caption
 * ("hace 3 d", "Lleva 3 días sin triar") moves with the real calendar: the artboards in `canvas/`
 * are the visual truth and they stay true over time. The literal used to be duplicated in
 * `features/planta/planta-format.ts` and `features/drift/drift-format.ts`; it lives here now (it is
 * mock data, not a formatting primitive) and those two re-export it as `NOW_ISO`, so their callers
 * did not change and no third copy can appear.
 *
 * It lines up with report-001's `createdAt` (09:56) so Planta's header reads "hace 4 min", and with
 * FB-007's `receivedAt` (12/09 09:00) so the Bandeja de entrada andon reads "Lleva 3 días sin triar",
 * exactly as `canvas/Entrada.dc.html` commits to.
 */
export const DEMO_NOW_ISO = '2026-09-15T10:00:00.000Z';

/** The frozen demo «ahora» as a fresh `Date` on every call (so callers never share a mutable one). */
export function referenceNow(): Date {
  return new Date(DEMO_NOW_ISO);
}
