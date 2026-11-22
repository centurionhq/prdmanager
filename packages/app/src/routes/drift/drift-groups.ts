/**
 * Grouping, message tokenization and acknowledge-target helpers for the Drift screen (SDD-013,
 * WO-361). Kept free of React, same convention as the Centurion Factory design package's own
 * `features/drift/drift-issue-groups.ts` this ports from mock `DriftIssue`s to the real `DriftIssueDto`.
 *
 * SDD-061/WO-615 adds the pure triage layer on top of that: two-level grouping (kind → blueprint),
 * filtering and pagination. Still no React import here — the screen wires state, this file decides.
 */
import type { DriftIssueDto } from '@prdm/contracts';

export const GROUP_LABELS: Readonly<Record<string, string>> = {
  code_out_of_sync: 'Código fuera de sincronía',
  work_order_out_of_sync: 'Órdenes fuera de sincronía',
  landed_but_open: 'Órdenes ya aterrizadas',
  broken_link: 'Enlaces rotos',
  invalid_link_target: 'Enlaces a un destino inválido',
  status_write_failed: 'Escritura de estado fallida',
  lifecycle_violation: 'Ciclo de vida',
  feature_changed: 'Features que cambiaron',
  blueprint_changed: 'Blueprints que cambiaron',
  deprecated_field: 'Campos deprecados',
  impacts_warning: 'Avisos de impacts_paths',
  awaiting_ci_report: 'Esperando reporte de CI',
  feature_without_blueprint: 'Features sin diseño',
  blueprint_without_feature: 'Diseños sin feature',
};

// The first two keep the exact relative order Drift.dc.html shows; the rest are interleaved by how
// closely they relate. Any `kind` not listed here still gets its own group via `groupIssues`'s fallback.
const GROUP_ORDER: readonly string[] = [
  'code_out_of_sync',
  // Both work-order classes stay adjacent: «Órdenes fuera de sincronía» then «Órdenes ya aterrizadas».
  'work_order_out_of_sync',
  'landed_but_open',
  'broken_link',
  'invalid_link_target',
  'status_write_failed',
  'lifecycle_violation',
  'feature_changed',
  'blueprint_changed',
  'deprecated_field',
  'impacts_warning',
  'awaiting_ci_report',
  'feature_without_blueprint',
  'blueprint_without_feature',
];

/** Label shown for issues the attribution step could not bind to a blueprint (SDD-061 R1). */
export const SUBGROUP_NO_BLUEPRINT_LABEL = 'Sin blueprint';

/** Second level of the grouping: the issues of one `kind` that share one `blueprintId`. */
export interface IssueSubgroup {
  readonly blueprintId: string | null;
  readonly label: string;
  readonly issues: readonly DriftIssueDto[];
}

export interface IssueGroup {
  readonly kind: string;
  readonly label: string;
  readonly subgroups: readonly IssueSubgroup[];
}

function labelFor(kind: string): string {
  return GROUP_LABELS[kind] ?? kind;
}

/** `blueprintId` or the explicit "Sin blueprint" label — an unattributed issue stays visible as such. */
export function subgroupLabel(blueprintId: string | null): string {
  return blueprintId ?? SUBGROUP_NO_BLUEPRINT_LABEL;
}

function subgroupsFor(kindIssues: readonly DriftIssueDto[]): readonly IssueSubgroup[] {
  const byBlueprint = new Map<string, DriftIssueDto[]>();
  const unattributed: DriftIssueDto[] = [];

  for (const issue of kindIssues) {
    if (issue.blueprintId === null) {
      unattributed.push(issue);
      continue;
    }
    const bucket = byBlueprint.get(issue.blueprintId);
    if (bucket) bucket.push(issue);
    else byBlueprint.set(issue.blueprintId, [issue]);
  }

  const attributed: IssueSubgroup[] = [...byBlueprint.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((blueprintId) => ({
      blueprintId,
      label: subgroupLabel(blueprintId),
      issues: byBlueprint.get(blueprintId) ?? [],
    }));

  // The unattributed subgroup is explicit and always last, so no issue is silently dropped.
  if (unattributed.length > 0) {
    attributed.push({ blueprintId: null, label: SUBGROUP_NO_BLUEPRINT_LABEL, issues: unattributed });
  }

  return attributed;
}

/**
 * Groups by kind, in `GROUP_ORDER` first then any other kind found, dropping empty groups; inside each
 * kind the issues are sub-grouped by `blueprintId` (ascending, "Sin blueprint" last).
 */
export function groupIssues(issues: readonly DriftIssueDto[]): readonly IssueGroup[] {
  const knownKinds = new Set(GROUP_ORDER);
  const extraKinds = Array.from(new Set(issues.map((issue) => issue.kind).filter((kind) => !knownKinds.has(kind))));
  return [...GROUP_ORDER, ...extraKinds]
    .map((kind) => ({ kind, label: labelFor(kind), issues: issues.filter((issue) => issue.kind === kind) }))
    .filter((group) => group.issues.length > 0)
    .map((group) => ({ kind: group.kind, label: group.label, subgroups: subgroupsFor(group.issues) }));
}

export function issuesForFeature(featureId: string | null, issues: readonly DriftIssueDto[]): readonly DriftIssueDto[] {
  if (!featureId) return issues;
  return issues.filter((issue) => issue.featureIds.includes(featureId));
}

/** The active filter set for the Drift list; `'all'` on a facet disables it (SDD-061 R2). */
export interface DriftFilters {
  readonly severity: 'all' | 'error' | 'warning';
  readonly kind: 'all' | string;
  readonly blueprintId: 'all' | string;
  readonly query: string;
}

export const EMPTY_FILTERS: DriftFilters = { severity: 'all', kind: 'all', blueprintId: 'all', query: '' };

function matchesQuery(issue: DriftIssueDto, query: string): boolean {
  const haystack = [issue.message, issue.nodeId, issue.target ?? '', issue.blueprintId ?? '', issue.featureIds.join(' ')]
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

/** ANDs every active facet; a blank/whitespace `query` does not filter (SDD-061 R2). */
export function filterIssues(issues: readonly DriftIssueDto[], filters: DriftFilters): readonly DriftIssueDto[] {
  const query = filters.query.trim().toLowerCase();
  return issues.filter((issue) => {
    if (filters.severity !== 'all' && issue.severity !== filters.severity) return false;
    if (filters.kind !== 'all' && issue.kind !== filters.kind) return false;
    if (filters.blueprintId !== 'all' && issue.blueprintId !== filters.blueprintId) return false;
    if (query && !matchesQuery(issue, query)) return false;
    return true;
  });
}

/** Rows rendered per subgroup before the "mostrar más" control appears (SDD-061 R3). */
export const PAGE_SIZE = 50;

export interface PaginatedIssues {
  readonly visible: readonly DriftIssueDto[];
  readonly remaining: number;
}

/**
 * Cuts `issues` to how many rows the subgroup has already revealed, never below `pageSize`, and reports
 * how many rows are still hidden. Going past the end is a no-op, not an overflow.
 */
export function paginateIssues(
  issues: readonly DriftIssueDto[],
  visible: number,
  pageSize: number = PAGE_SIZE,
): PaginatedIssues {
  const shown = Math.max(visible, pageSize);
  return { visible: issues.slice(0, shown), remaining: Math.max(0, issues.length - shown) };
}

export interface MessageToken {
  readonly text: string;
  readonly mono: boolean;
}

export interface SplitMessageOptions {
  /**
   * Exact substrings the caller itself wrote into `message` and wants rendered as `.id` (SDD-107 D2). A
   * commit sha is indistinguishable from any other 7-character hex word by pattern — widening the regex
   * would also turn «defaced» into mono on the raw-message fallback — so whoever writes the sha names it here.
   */
  readonly literals?: readonly string[];
}

// Matches literal ids (WO-310, SDD-012, FR-002…) and repo paths / branch names (contain a "/").
const MONO_TOKEN_PATTERN = /\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|\b[A-Z]{2,4}-\d+\b/g;

interface MonoRange {
  readonly start: number;
  readonly end: number;
}

function literalRanges(message: string, literals: readonly string[]): readonly MonoRange[] {
  const ranges: MonoRange[] = [];
  for (const literal of literals) {
    if (literal === '') continue;
    let at = message.indexOf(literal);
    while (at !== -1) {
      ranges.push({ start: at, end: at + literal.length });
      at = message.indexOf(literal, at + literal.length);
    }
  }
  return ranges;
}

/**
 * Splits an issue message into plain/mono runs so ids, paths and the literals the caller declares render in
 * `.id` type. Ranges are non-overlapping: the first one wins on a tie, the rest stay part of that token.
 */
export function splitMessage(message: string, options: SplitMessageOptions = {}): readonly MessageToken[] {
  const ranges: MonoRange[] = [];
  for (const match of message.matchAll(MONO_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }
  ranges.push(...literalRanges(message, options.literals ?? []));
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  const tokens: MessageToken[] = [];
  let cursor = 0;

  for (const range of ranges) {
    // A range already covered by the previous token (a literal inside a longer id) is not split again.
    if (range.start < cursor) continue;
    if (range.start > cursor) tokens.push({ text: message.slice(cursor, range.start), mono: false });
    tokens.push({ text: message.slice(range.start, range.end), mono: true });
    cursor = range.end;
  }
  if (cursor < message.length) tokens.push({ text: message.slice(cursor), mono: false });

  return tokens;
}

export const PROJECT_TARGET = 'all';

/**
 * Document ids the acknowledge endpoint accepts as a `target` (SDD-111 D2). Hand-synced with
 * `packages/contracts/src/drift.ts:12`'s `ACK_TARGET_PATTERN` — same convention as that file's own
 * hand-sync with `@prdm/core`'s `ID_PATTERN` and `documents.ts`'s `DOCUMENT_KINDS`. `all` is not part of it:
 * the project-wide target is {@link PROJECT_TARGET}, decided here and never derived from an issue.
 *
 * `WO` is deliberately absent. The `DriftIssueDto` does not carry a work order's status, and the server
 * rejects any work order that is not `done`/`out_of_sync` (`core/src/sync/monitor.ts:351-353`), so a per-row
 * action on a `WO-` row would be a button that fails for real pending work. Those rows have no target of their
 * own; the subgroup of their blueprint covers them (SDD-111 D4).
 */
const ACK_TARGET_PATTERN = /^(MRD|PRD|FR|SDD|ADR|ART|FB)-\d{3,9}$/;

/**
 * Issue kinds that moving the baseline actually resolves (SDD-111 A1, `core/src/sync/monitor.ts:215-229`):
 * the governed code refs and the finished work orders. Everything else — `lifecycle_violation`,
 * `impacts_warning` from a declared pattern, `landed_but_open`, links, deprecated fields, changed
 * features/blueprints — depends on the graph or on a work order's state, not on the baseline, and stays on
 * screen after an acknowledge. Counting them as "resolved" would be the most expensive lie on this screen.
 */
const RESOLVABLE_KINDS: ReadonlySet<string> = new Set(['code_out_of_sync', 'work_order_out_of_sync']);

export interface AcknowledgeTarget {
  /** `PROJECT_TARGET` or the document id sent to `POST .../drift/acknowledge`. */
  readonly value: string;
  /** Composed here so the select, the summary and the toast say the same thing: `SDD-013 · 15 issues`. */
  readonly label: string;
  /** Every issue the named document carries today — never the filtered view (SDD-111 D1). */
  readonly count: number;
  /** The part of `count` that acknowledging removes from the list (see {@link RESOLVABLE_KINDS}). */
  readonly resolvable: number;
  /** Documents a confirmation advances: 1 for a document, N for {@link PROJECT_TARGET} (SDD-111 A4). */
  readonly documents: number;
}

function issueCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'issue' : 'issues'}`;
}

/**
 * The document a row can be acknowledged through (SDD-111 D2): its blueprint when the attribution found one,
 * otherwise the issue's own `nodeId` when that is a real document id. `null` means "no per-row action" — the
 * row is covered from its subgroup or from "Todo el proyecto", never by a button the server would reject.
 *
 * A `WO-` row returns `null` even when it has a blueprint: the `DriftIssueDto` does not carry the work order's
 * status and the server rejects any work order that is not `done`/`out_of_sync` (`monitor.ts:351-353`), so the
 * row itself is not a safe action. Its blueprint's subgroup does cover it.
 */
export function acknowledgeTargetFor(issue: DriftIssueDto): string | null {
  if (issue.nodeId.startsWith('WO-')) return null;
  if (issue.blueprintId) return issue.blueprintId;
  return ACK_TARGET_PATTERN.test(issue.nodeId) ? issue.nodeId : null;
}

/**
 * Every document that carries debt today, in the order it first appears in `issues` (SDD-111 A3: no
 * reordering by count; prioritizing belongs to the list, PRD-041), plus "Todo el proyecto" last.
 *
 * Counts are taken over the list as given — call it with the unfiltered report, never with the visible rows:
 * an acknowledge moves `baseline.docs[id]`/`governs[bp]` for the whole document (`monitor.ts:345-356`), so a
 * count that followed a filter would under-report an irreversible action.
 */
export function acknowledgeableTargets(issues: readonly DriftIssueDto[]): readonly AcknowledgeTarget[] {
  interface Draft {
    readonly value: string;
    count: number;
    resolvable: number;
  }

  const drafts: Draft[] = [];
  const byValue = new Map<string, Draft>();
  for (const issue of issues) {
    const value = acknowledgeTargetFor(issue);
    if (value === null) continue;
    let draft = byValue.get(value);
    if (!draft) {
      draft = { value, count: 0, resolvable: 0 };
      byValue.set(value, draft);
      drafts.push(draft);
    }
    draft.count += 1;
    if (RESOLVABLE_KINDS.has(issue.kind)) draft.resolvable += 1;
  }

  const targets: AcknowledgeTarget[] = drafts.map((draft) => ({
    value: draft.value,
    label: `${draft.value} · ${issueCountLabel(draft.count)}`,
    count: draft.count,
    resolvable: draft.resolvable,
    documents: 1,
  }));

  return [
    ...targets,
    {
      value: PROJECT_TARGET,
      label: `Todo el proyecto · ${issueCountLabel(issues.length)}`,
      count: issues.length,
      resolvable: issues.filter((issue) => RESOLVABLE_KINDS.has(issue.kind)).length,
      documents: targets.length,
    },
  ];
}
