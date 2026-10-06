/**
 * What the writing guide says about each required section of a Business Case, and which ones already have
 * something written under them (SDD-053/PRD-033 R2).
 *
 * The headings come from `@prdm/core/domain`'s `BC_REQUIRED_SECTIONS` -- the very list the publish gate checks
 * -- so the guide can never walk someone through a set of sections the gate does not recognise. Only the copy
 * lives here. Note the two different questions asked about the same list: the gate asks whether the *heading*
 * exists (the template seeds all four), and the guide asks whether anything is *written under* it.
 */
import { BC_REQUIRED_SECTIONS } from '@prdm/core/domain';

export interface BusinessCaseSectionCopy {
  /** The exact `## ...` heading in the document. */
  readonly heading: string;
  /** The same thing said the way someone from the business would say it. */
  readonly label: string;
  readonly hint: string;
}

const COPY_BY_HEADING: Readonly<Record<string, { label: string; hint: string }>> = {
  '## Problema': { label: 'El problema', hint: 'Qué duele hoy y a quién. Sin proponer solución todavía.' },
  '## Impacto esperado': { label: 'Qué cambia si lo hacemos', hint: 'El impacto esperado, en términos de quien sufre el problema.' },
  '## Métrica de éxito': { label: 'Cómo sabremos que funcionó', hint: 'Una métrica con su valor de hoy y el que buscás. Si no se puede medir, decilo así.' },
  '## Costo estimado': { label: 'Cuánto cuesta, a grandes rasgos', hint: 'Qué se toca y qué no. Orden de magnitud, no estimación fina.' },
};

export const BUSINESS_CASE_SECTIONS: readonly BusinessCaseSectionCopy[] = BC_REQUIRED_SECTIONS.map((heading) => ({
  heading,
  label: COPY_BY_HEADING[heading]?.label ?? heading.replace(/^#+\s*/, ''),
  hint: COPY_BY_HEADING[heading]?.hint ?? '',
}));

const ANY_HEADING = /^##\s+.+$/m;

/** True when `body` has that exact heading line and something other than whitespace before the next heading. */
function isWritten(body: string, heading: string): boolean {
  const lines = body.split('\n');
  const index = lines.findIndex((line) => line.trim() === heading);
  if (index === -1) return false;
  const rest = lines.slice(index + 1).join('\n');
  const next = ANY_HEADING.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim().length > 0;
}

export interface BusinessCaseSectionState extends BusinessCaseSectionCopy {
  readonly written: boolean;
  /** The first section still missing: the one the guide points at. At most one, none once all four are done. */
  readonly current: boolean;
}

export function businessCaseSectionStates(body: string): BusinessCaseSectionState[] {
  const written = BUSINESS_CASE_SECTIONS.map((section) => isWritten(body, section.heading));
  const currentIndex = written.indexOf(false);
  return BUSINESS_CASE_SECTIONS.map((section, index) => ({ ...section, written: written[index] ?? false, current: index === currentIndex }));
}
