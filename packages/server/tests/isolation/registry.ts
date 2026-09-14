/**
 * The isolation probe table (SDD-006 §Aislamiento por capas point 4, WO-111): one entry per registered
 * route, keyed by `${METHOD} ${path}`. `registerIsolationProbe` is the extension point named in
 * WO-111's own scope note ("SDD-008 y SDD-010 suman sus casos") — a later WO (SDD-008's `/collab`
 * `documentName`s, SDD-010's MCP `tools/list`) imports this module and calls it to add its own cases
 * without touching this file or `isolation.test.ts`.
 */
import type { RouteProbeConfig } from './types.js';

const table = new Map<string, RouteProbeConfig>();

export function isolationRouteKey(method: string, path: string): string {
  return `${method} ${path}`;
}

/** Registers (or overwrites) the probe config for one route. Called both by this module's own
 * `BASE_ROUTE_TABLE` registration below and by any later WO extending coverage to routes this file
 * doesn't know about (SDD-008/SDD-010). */
export function registerIsolationProbe(method: string, path: string, config: RouteProbeConfig): void {
  table.set(isolationRouteKey(method, path), config);
}

export function getIsolationProbe(method: string, path: string): RouteProbeConfig | undefined {
  return table.get(isolationRouteKey(method, path));
}

export function isolationTableSize(): number {
  return table.size;
}
