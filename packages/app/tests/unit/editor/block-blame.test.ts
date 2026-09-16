/**
 * WO-381 — `blockBlameAttribution` maps a `SourceBlock`'s source-offset span to the line range it covers
 * (`BlameResult.lines` is 0-indexed, matching `body.split('\n')` — same convention `computeBlame`,
 * `@prdm/collab`, already uses) and picks the most recently-received attribution among those lines, the
 * same "most recent wins" rule `computeBlame` itself uses per line.
 */
import { describe, expect, it } from 'vitest';
import { blockBlameAttribution } from '../../../src/editor/block-blame.js';
import { classifyDocument } from '../../../src/editor/source-map.js';
import type { BlameResult } from '@prdm/collab';

function attribution(userId: string, receivedAt: string) {
  return { actorKind: 'user' as const, userId, onBehalfOf: null, agentId: null, receivedAt };
}

describe('blockBlameAttribution', () => {
  it('returns the single line attribution for a one-line block', () => {
    const source = 'Title\n\nSecond paragraph.';
    const block = classifyDocument(source)[0]!; // heading "Title", line 0
    const blame: BlameResult = { lines: [{ line: 0, attribution: attribution('ana', '2026-01-01T00:00:00Z') }], fields: {} };

    expect(blockBlameAttribution(source, block, blame)?.userId).toBe('ana');
  });

  it('picks the most recently-received attribution among a multi-line block', () => {
    const source = 'line one\nline two\nline three';
    const block = classifyDocument(source).find((b) => source.slice(b.from, b.to).includes('line one'))!;
    // A single paragraph block spans all three lines here since they're a single "loose" paragraph in the
    // markdown grammar (no blank line between them) — exactly the multi-line case this WO cares about.
    const blame: BlameResult = {
      lines: [
        { line: 0, attribution: attribution('ana', '2026-01-01T00:00:00Z') },
        { line: 1, attribution: attribution('beto', '2026-01-03T00:00:00Z') },
        { line: 2, attribution: attribution('caro', '2026-01-02T00:00:00Z') },
      ],
      fields: {},
    };

    expect(blockBlameAttribution(source, block, blame)?.userId).toBe('beto');
  });

  it('returns null when no line in the block has an attribution', () => {
    const source = 'untouched line';
    const block = classifyDocument(source)[0]!;
    const blame: BlameResult = { lines: [{ line: 0, attribution: null }], fields: {} };

    expect(blockBlameAttribution(source, block, blame)).toBeNull();
  });
});
