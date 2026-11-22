import type { DocKind } from './schema.js';

/**
 * The four sections a Business Case must carry (PRD-011 §4.1/SDD-022), seeded by `templateFor('BC')`.
 * Typed as a literal tuple so `BusinessCaseSection` (re-exported by `business-case.ts`) stays a literal union.
 */
export const BC_REQUIRED_SECTIONS = ['## Problema', '## Impacto esperado', '## Métrica de éxito', '## Costo estimado'] as const;

/**
 * Single table of the headings each document kind must carry (SDD-124), shared by the publish gate
 * (`../lifecycle/check.ts`) and, later, templates/authoring. Browser-safe: no node:fs, no lifecycle import.
 * Kinds without a section requirement (MRD, WO, FB, ART) are `[]`: their rules are about fields/links.
 */
export const REQUIRED_SECTIONS: Readonly<Record<DocKind, readonly string[]>> = {
  BC: BC_REQUIRED_SECTIONS,
  PRD: ['## Problema', '## Alcance', '## Personas y trabajos', '## Métrica de éxito', '## Features derivadas'],
  FR: ['## Alcance', '## Criterio de aceptación'],
  SDD: ['## Tareas'],
  ADR: ['## Tareas'],
  MRD: [],
  WO: [],
  FB: [],
  ART: [],
};

/**
 * The exact violation text for a document missing required sections. The SDD names the first parameter
 * `kind`, but the format it fixes ("<id> is missing ...") has the document's id as subject, so the first
 * argument is the document id (e.g. `BC-001`), not its kind.
 */
export function MISSING_SECTIONS_MESSAGE(id: string, missing: readonly string[]): string {
  return `${id} is missing required section(s): ${missing.join(', ')}`;
}

/** Headings of `REQUIRED_SECTIONS[kind]` with no exact (trimmed-line) match in `body`: heading presence, not content. */
export function missingSections(kind: DocKind, body: string): string[] {
  const lines = new Set(body.split('\n').map((line) => line.trim()));
  return REQUIRED_SECTIONS[kind].filter((heading) => !lines.has(heading));
}
