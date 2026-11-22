/**
 * The four sections a Business Case must carry (PRD-011 §4.1/SDD-022), seeded by `templateFor('BC')`.
 *
 * The source of truth is now `required-sections.ts` (SDD-124, the single table of required sections per
 * kind); this module re-exports it so existing `@prdm/core/domain` consumers keep working. Two very
 * different readers need the same list and must never drift apart (SDD-053): the publish gate, which checks
 * that each heading *exists*, and the client's writing guide, which walks someone through them one by one.
 * `packages/app` may only import values from this subpath.
 */
import { BC_REQUIRED_SECTIONS } from './required-sections.js';

export { BC_REQUIRED_SECTIONS };
export type BusinessCaseSection = (typeof BC_REQUIRED_SECTIONS)[number];
