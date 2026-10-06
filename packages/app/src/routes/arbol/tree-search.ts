import type { TreeNode } from '@prdm/core';

/**
 * SDD-083 D4: plegado de tildes y mayúsculas. `normalize('NFD')` descompone cada carácter y `\p{Diacritic}`
 * borra el acento suelto; después minúsculas. Idempotente.
 */
export function normalizeQuery(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/** WO-461 (movida desde ProjectGraph.tsx), con el plegado de D4: un nodo sobrevive si él -- por ref o por
 * título -- o algún descendiente coincide, así el acierto conserva a sus ancestros. */
export function filterForestByQuery(nodes: readonly TreeNode[], query: string): TreeNode[] {
  const needle = normalizeQuery(query).trim();
  if (!needle) return [...nodes];
  return nodes.flatMap((node) => {
    const children = filterForestByQuery(node.children, needle);
    const matches = normalizeQuery(node.ref).includes(needle) || normalizeQuery(node.title).includes(needle);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
}

/** SDD-083 D2: la N de «N resultados de M features» -- cada nodo del bosque YA filtrado (los ancestros que
 * se conservan por contexto cuentan, igual que se ven en el árbol). */
export function countMatches(nodes: readonly TreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countMatches(node.children), 0);
}
