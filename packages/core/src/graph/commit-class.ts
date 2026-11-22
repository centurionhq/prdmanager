/**
 * Clasificación del hueco de trazabilidad (SDD-095 D2): una sola regla, expresada dos veces con la MISMA
 * fuente — un fragmento Cypher (`untracedCommitClassCypher`, lo usa UNTRACED_COMMITS) y su espejo TS puro
 * (`classifyCommit`). Precedencia fija: merge > bookkeeping > code. Ante la duda, `code`: nunca se esconde trabajo.
 */
import type { UntracedCommitClass } from './types.js';

/** Mismo literal que se pasa como `$bookkeepingSubject` al Cypher y que compila `classifyCommit`.
 * Ojo: Neo4j evalúa `=~` como match COMPLETO (Java `matches()`), no como búsqueda — de ahí el `.*$`
 * final: sin él, `=~` exigiría que el subject termine justo después del prefijo. */
export const BOOKKEEPING_SUBJECT_PATTERN = '^(chore|docs|build|ci)(\\(|:|!)?\\b.*$';
export const BOOKKEEPING_PATH_PREFIXES = ['docs/', '.prdm/', 'design/'] as const;
export const BOOKKEEPING_PATH_SUFFIX = '.md';

const SUBJECT_REGEX = new RegExp(BOOKKEEPING_SUBJECT_PATTERN);

const cypherString = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Fragmento `CASE … END` que devuelve `'merge' | 'bookkeeping' | 'code'` para el nodo `alias`. Requiere `$bookkeepingSubject`. */
export function untracedCommitClassCypher(alias: string): string {
  const files = `coalesce(${alias}.files, [])`;
  const pathTests = [...BOOKKEEPING_PATH_PREFIXES.map((p) => `f STARTS WITH ${cypherString(p)}`), `f ENDS WITH ${cypherString(BOOKKEEPING_PATH_SUFFIX)}`].join(' OR ');
  return `CASE
    WHEN coalesce(${alias}.parentCount, 0) >= 2 THEN 'merge'
    WHEN (size(${files}) > 0 AND all(f IN ${files} WHERE ${pathTests}))
      OR (size(${files}) = 0 AND coalesce(${alias}.subject, '') =~ $bookkeepingSubject) THEN 'bookkeeping'
    ELSE 'code'
  END`;
}

const isBookkeepingPath = (file: string): boolean => BOOKKEEPING_PATH_PREFIXES.some((p) => file.startsWith(p)) || file.endsWith(BOOKKEEPING_PATH_SUFFIX);

export function classifyCommit(commit: { parentCount: number; files: readonly string[]; subject: string }): UntracedCommitClass {
  if (commit.parentCount >= 2) return 'merge';
  if (commit.files.length > 0) return commit.files.every(isBookkeepingPath) ? 'bookkeeping' : 'code';
  return SUBJECT_REGEX.test(commit.subject) ? 'bookkeeping' : 'code';
}
