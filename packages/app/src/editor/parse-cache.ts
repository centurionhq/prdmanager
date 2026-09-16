/**
 * Caches `classifyDocument`'s lezer parse per `Y.Text` instance (SDD-014 perf budget, WO-384).
 *
 * A single keystroke in `PreviewEditor` classifies the document several times over: `usePreviewInput`'s
 * `beforeinput` handler classifies the pre-edit source to resolve the caret into a block/offset, the
 * resulting re-render classifies the post-edit source to build the DOM, and the layout effect right after
 * that classifies it again to restore the caret. Without this cache, each of those calls independently
 * re-runs `@lezer/markdown`'s block parser over the *entire* document — a cold parse of a realistic ~200KB
 * document already costs ~20-25ms on its own (measured directly in PreviewEditor.performance.test.tsx),
 * several times the whole 16ms-per-edit budget before any DOM work even starts.
 *
 * `recordEdit` is called exactly once per local edit, from `y-binding.ts`'s `applySplice` — the single
 * funnel every local edit (typing, toolbar marks, paste, composition) already goes through — right when the
 * edit's exact `{ from, oldEnd, newEnd }` range is known. It reuses the previous parse's unaffected
 * subtrees via `TreeFragment.applyChanges`, so only the region around the edit is actually re-parsed.
 * `classifyCached` is what every other call site (`PreviewEditor`, `usePreviewInput`) uses instead of
 * `classifyDocument` directly: a cache hit (the common case, since `recordEdit` already primed the entry
 * for the exact resulting source) costs nothing beyond a `WeakMap` lookup and a string comparison.
 */
import { TreeFragment, type Tree } from '@lezer/common';
import type * as Y from 'yjs';
import { classifyTree, markdownParser, type SourceBlock } from './source-map.js';

export interface DocumentChange {
  from: number;
  oldEnd: number;
  newEnd: number;
}

interface CacheEntry {
  source: string;
  tree: Tree;
  blocks: SourceBlock[];
}

const cache = new WeakMap<Y.Text, CacheEntry>();

function buildEntry(source: string, tree: Tree): CacheEntry {
  return { source, tree, blocks: classifyTree(tree, source) };
}

/** Returns `source`'s blocks, reusing the cached parse for `ytext` when the cached source still matches
 * (the common case right after `recordEdit` primed it) and falling back to a full parse otherwise — e.g.
 * the very first render, or a source change that didn't go through `applySplice` (a remote collaborator's
 * edit, an undo/redo). */
export function classifyCached(ytext: Y.Text, source: string): SourceBlock[] {
  const cached = cache.get(ytext);
  if (cached && cached.source === source) return cached.blocks;

  const entry = buildEntry(source, markdownParser.parse(source));
  cache.set(ytext, entry);
  return entry.blocks;
}

/** Parses `newSource` incrementally against the cached tree for `ytext` (if any) using `change`'s exact
 * offsets, and primes the cache with the result so the next `classifyCached(ytext, newSource)` call — the
 * re-render this same edit triggers — is free. */
export function recordEdit(ytext: Y.Text, newSource: string, change: DocumentChange): SourceBlock[] {
  const previous = cache.get(ytext);
  const fragments = previous
    ? TreeFragment.applyChanges(TreeFragment.addTree(previous.tree), [
        { fromA: change.from, toA: change.oldEnd, fromB: change.from, toB: change.newEnd },
      ])
    : undefined;

  const entry = buildEntry(newSource, markdownParser.parse(newSource, fragments));
  cache.set(ytext, entry);
  return entry.blocks;
}
