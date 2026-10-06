/**
 * Human-readable copy for a Drift issue (SDD-059, WO-625). The raw engine `message` is a stable contract
 * (`packages/core/src/sync/monitor.ts`) and the issue `id` is derived from it server-side
 * (`packages/server/src/api/project-drift-issues.ts:59`), so it is never rewritten — this module only turns
 * it into Spanish copy at render time. Pure and React-free, same convention as `drift-groups.ts`, from
 * which it borrows `splitMessage`/`MessageToken` so ids and paths keep rendering in monospace.
 */
import type { DriftIssueDto } from '@prdm/contracts';
import { splitMessage, type MessageToken } from './drift-groups.js';

/** Explanation shown for a blueprint id in an issue's glossary. */
const BLUEPRINT_TIP =
  'Un blueprint (SDD/ADR) es el diseño técnico que gobierna qué archivos y símbolos deben coincidir con él.';

/**
 * `GovernedReason` (`packages/core/src/sync/monitor.ts:52`) to the Spanish clause appended to a
 * `code_out_of_sync` headline. `unchanged`, `new` and `resolved_by_commit` never describe an
 * `out_of_sync` issue, so they get no entry here and `reasonFromMessage` treats them as unknown.
 */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  code_changed: 'el archivo cambió desde la última vez que se reconoció',
  missing: 'el archivo ya no existe en el repositorio',
  blueprint_changed: 'el diseño cambió después de este código',
  feature_changed: 'la feature de la que depende cambió',
};

// Only the governed-reason enum between parentheses at the very end of the message, e.g. `(code_changed)`.
const REASON_PATTERN = /\(([a-z_]+)\)$/;

/**
 * The reason the engine reported for an issue, or `null` when the message has no trailing enum or carries
 * one this module does not know. Never throws on an unexpected message shape: an unknown format degrades
 * to "no reason", not to a crash.
 */
export function reasonFromMessage(message: string): string | null {
  const match = REASON_PATTERN.exec(message.trim());
  if (!match) return null;
  const reason = match[1];
  if (reason === undefined || !Object.prototype.hasOwnProperty.call(REASON_LABELS, reason)) return null;
  return reason;
}

/** The id a kind's copy names: the attributed blueprint when there is one, else the issue's own node. */
function blueprintOrNode(issue: DriftIssueDto): string {
  return issue.blueprintId ?? issue.nodeId;
}

/**
 * `code_out_of_sync` names the file and, when the engine reported a known reason, why it drifted. With no
 * `target` it avoids mentioning a file it does not have and falls back to the raw message in parentheses —
 * information is never hidden.
 */
function codeOutOfSyncHeadline(issue: DriftIssueDto): string {
  const blueprint = blueprintOrNode(issue);
  const target = issue.target;
  if (target === undefined) {
    return `El blueprint ${blueprint} está fuera de sincronía con su código (${issue.message})`;
  }
  const base = `El archivo ${target} no coincide con ${blueprint}`;
  const reason = reasonFromMessage(issue.message);
  if (reason === null) return base;
  const label = REASON_LABELS[reason];
  return label === undefined ? base : `${base}, porque ${label}`;
}

/** `broken_link` names the dangling target, or falls back to the raw message when there is none. */
function brokenLinkHeadline(issue: DriftIssueDto): string {
  const target = issue.target;
  if (target === undefined) return `El documento ${issue.nodeId} tiene un enlace roto (${issue.message})`;
  return `El documento ${issue.nodeId} enlaza a ${target}, que ya no existe`;
}

/**
 * One row per `IssueKind` (`packages/core/src/sync/monitor.ts:18`): the Spanish headline and the suggested
 * action shown as "Qué hacer:". `headline` always names the real issue values, never a literal placeholder;
 * `action: null` is reserved for the unknown-kind fallback, where there is nothing safe to suggest.
 */
export const KIND_COPY: Readonly<
  Record<string, { readonly headline: (issue: DriftIssueDto) => string; readonly action: string | null }>
> = {
  code_out_of_sync: {
    headline: codeOutOfSyncHeadline,
    action: 'Actualizá el código o, si el cambio es correcto, reconocé el drift',
  },
  blueprint_changed: {
    headline: (issue) => `El blueprint ${issue.nodeId} cambió desde la última vez que se reconoció`,
    action: 'Revisá los blueprints y órdenes que dependen de él y volvé a reconocer',
  },
  feature_changed: {
    headline: (issue) => `La feature ${issue.nodeId} cambió desde su última versión reconocida`,
    action: 'Revisá los blueprints que la arquitectan',
  },
  work_order_out_of_sync: {
    headline: (issue) => `La orden ${issue.nodeId} se completó contra una versión anterior de su blueprint`,
    action: 'Volvé a completarla o reconocela individualmente',
  },
  impacts_warning: {
    headline: (issue) => `Un patrón de impacts_paths del blueprint ${blueprintOrNode(issue)} no resuelve a nada en disco`,
    action: 'Corregí el impacts_paths del blueprint',
  },
  awaiting_ci_report: {
    headline: (issue) => `El blueprint ${blueprintOrNode(issue)} espera un reporte de CI que cubra sus paths`,
    action: 'Esperá el próximo reporte o disparalo',
  },
  broken_link: {
    headline: brokenLinkHeadline,
    action: 'Corregí o quitá el enlace',
  },
  invalid_link_target: {
    headline: (issue) => `Un enlace del documento ${issue.nodeId} apunta al tipo de documento equivocado`,
    action: 'Apuntá el enlace al tipo correcto',
  },
  deprecated_field: {
    headline: (issue) => `El documento ${issue.nodeId} usa un campo deprecado`,
    action: 'Corré prdm migrate docs',
  },
  lifecycle_violation: {
    headline: (issue) => `El documento ${issue.nodeId} no cumple una regla de ciclo de vida`,
    action: 'Completá la relación o el campo que exige la regla',
  },
  status_write_failed: {
    headline: (issue) => `No se pudo escribir el estado del documento ${issue.nodeId}`,
    action: 'Reintentá; si persiste, revisá el estado del proyecto',
  },
};

export interface GlossaryTerm {
  readonly term: string;
  readonly tip: string;
}

export interface IssueCopy {
  readonly headline: string;
  readonly tokens: readonly MessageToken[];
  readonly action: string | null;
  readonly glossary: readonly GlossaryTerm[];
}

/**
 * The glossary for one issue: its blueprint id (explaining what a blueprint is) plus, for a kind this
 * module knows, the reason the engine reported with its own explanation. An unknown kind keeps showing the
 * blueprint — never hides information — but claims no reason it cannot interpret.
 */
function glossaryFor(issue: DriftIssueDto, reason: string | null): readonly GlossaryTerm[] {
  const terms: GlossaryTerm[] = [];
  if (issue.blueprintId !== null) terms.push({ term: issue.blueprintId, tip: BLUEPRINT_TIP });
  if (reason !== null) {
    const label = REASON_LABELS[reason];
    if (label !== undefined) terms.push({ term: reason, tip: `Razón detectada: ${label}.` });
  }
  return terms;
}

/**
 * Turns a `DriftIssueDto` into the copy a human reads. An unknown `kind` keeps the raw `message` as the
 * only headline, with no action, so a new engine kind degrades visibly instead of breaking the screen.
 */
export function issueCopy(issue: DriftIssueDto): IssueCopy {
  const copy = KIND_COPY[issue.kind];
  const headline = copy ? copy.headline(issue) : issue.message;
  const action = copy ? copy.action : null;
  return {
    headline,
    tokens: splitMessage(headline),
    action,
    glossary: glossaryFor(issue, copy ? reasonFromMessage(issue.message) : null),
  };
}
