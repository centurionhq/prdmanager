/**
 * Readable-copy path convention (SDD-074 D1/D4). In remote mode `docs/` only ships `model/`; the readable
 * document lives in the cache `prdm sync` writes under `.prdm/remote/docs/<ID>.md` (see
 * `packages/contracts/src/governance.ts`). The server cannot probe the client's disk, so the path is
 * derived from this convention — never from the filesystem. Single definition of the convention.
 */
export const MIRROR_DOCS_DIR = '.prdm/remote/docs';

export function mirrorPathFor(id: string): string {
  return `${MIRROR_DOCS_DIR}/${id}.md`;
}
