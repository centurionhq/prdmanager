import type { NodeLabel } from '@prdm/core';
import type { StylesheetJson } from 'cytoscape';

/**
 * `styles/graph-stylesheet.ts` (SDD-005 "Frontend"): shape encodes document kind, color+stroke-style encodes
 * status, and drift is layered on top as a dashed amber/red ring plus a small badge — never color alone (a
 * colorblind or grayscale-display user still reads shape + line style + the badge).
 *
 * Reads CSS custom properties straight from `tokens.css` via `getComputedStyle`, so the graph never hard-codes a
 * color the design tokens don't already own, and it re-themes for free with the OS light/dark switch.
 */
const SHAPE_BY_LABEL: Record<NodeLabel, string> = {
  Feature: 'round-rectangle',
  Blueprint: 'round-hexagon',
  WorkOrder: 'ellipse',
  Feedback: 'round-diamond',
  Artifact: 'round-diamond',
};

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** `status` is a free-form string per node kind (`new`/`approved`/`closed`, `pending`/`in_progress`/`done`/`out_of_sync`, `active`, …) — grouped into the few states this palette actually distinguishes. */
function statusGroup(status: string | undefined): 'done' | 'active' | 'attention' | 'neutral' {
  switch (status) {
    case 'closed':
    case 'done':
      return 'done';
    case 'in_progress':
    case 'active':
    case 'approved':
      return 'active';
    case 'out_of_sync':
      return 'attention';
    default:
      return 'neutral';
  }
}

/**
 * `buildGraphStylesheet()` (SDD-005 "Frontend"): called once per `useCytoscape` mount (tokens don't change without
 * a full page re-render on an OS theme switch, so there's no need to rebuild it on every render).
 */
export function buildGraphStylesheet(): StylesheetJson {
  const fg = readToken('--color-fg');
  const fgMuted = readToken('--color-fg-muted');
  const border = readToken('--color-border-solid');
  const bgElevated = readToken('--color-bg-elevated-solid');
  const accent = readToken('--color-accent');
  const ok = readToken('--color-status-ok');
  const warning = readToken('--color-status-warning');
  const error = readToken('--color-status-error');
  const neutral = readToken('--color-status-neutral');
  const fontMono = readToken('--font-mono');

  const statusColor: Record<ReturnType<typeof statusGroup>, string> = { done: neutral, active: ok, attention: warning, neutral };

  return [
    {
      selector: 'node',
      style: {
        shape: 'round-rectangle',
        label: 'data(id)',
        'font-family': fontMono,
        'font-size': 11,
        'font-weight': 600,
        color: fg,
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'wrap',
        'text-max-width': '90px',
        width: 92,
        height: 40,
        'background-color': bgElevated,
        'border-width': 2,
        'border-color': border,
        'border-opacity': 1,
      },
    },
    ...(Object.keys(SHAPE_BY_LABEL) as NodeLabel[]).map((label) => ({
      selector: `node[label = "${label}"]`,
      style: { shape: SHAPE_BY_LABEL[label] as never },
    })),
    // Status ring: same shape, colored border — never the fill, so the identifier text (always `fg` on `bgElevated`) keeps its contrast regardless of status.
    { selector: 'node[status = "in_progress"], node[status = "active"], node[status = "approved"]', style: { 'border-color': statusColor.active } },
    { selector: 'node[status = "closed"], node[status = "done"]', style: { 'border-color': statusColor.done, 'border-style': 'dashed' } },
    { selector: 'node[status = "out_of_sync"]', style: { 'border-color': statusColor.attention, 'border-width': 3 } },
    // Drift badge: `apply-drift.ts` sets data.drift = true. Dashed double-width red ring + a small "!" node label
    // override — the shape and dash pattern carry the meaning as much as the color does.
    {
      selector: 'node[?drift]',
      style: {
        'border-color': error,
        'border-width': 4,
        'border-style': 'dashed',
      },
    },
    {
      selector: 'node:selected',
      style: {
        'border-color': accent,
        'border-width': 4,
        'background-color': bgElevated,
        'overlay-color': accent,
        'overlay-opacity': 0.18,
        'overlay-padding': 6,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': border,
        'target-arrow-color': border,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.9,
        'curve-style': 'bezier',
        label: 'data(type)',
        'font-family': fontMono,
        'font-size': 8,
        color: fgMuted,
        'text-rotation': 'autorotate',
        'text-background-color': bgElevated,
        'text-background-opacity': 1,
        'text-background-padding': '2px',
      },
    },
    { selector: 'edge[?reviewNeeded]', style: { 'line-color': warning, 'target-arrow-color': warning, 'line-style': 'dashed' } },
  ];
}
