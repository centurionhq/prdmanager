/**
 * The four sections a Business Case must carry (PRD-011 §4.1/SDD-022), seeded by `templateFor('BC')`.
 *
 * It lives on the browser-safe `@prdm/core/domain` subpath, not next to the rule that enforces it
 * (`../lifecycle/check.ts`), because two very different readers need the same list and must never drift
 * apart (SDD-053): the publish gate, which checks that each heading *exists*, and the client's writing
 * guide, which walks someone through them one by one and shows which ones already have something written
 * under them. `packages/app` may only import values from this subpath.
 */
export const BC_REQUIRED_SECTIONS = ['## Problema', '## Impacto esperado', '## Métrica de éxito', '## Costo estimado'] as const;
export type BusinessCaseSection = (typeof BC_REQUIRED_SECTIONS)[number];
