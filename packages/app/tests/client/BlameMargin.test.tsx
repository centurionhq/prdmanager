/**
 * WO-381 — `BlameMargin` shows each block's last-editor initial/tooltip, portaled into that block's own
 * DOM node, same underlying data (`BlameResult`) and label formatting (`describeAttribution`) as the
 * Markdown tab's `blame-gutter.ts`, just a margin instead of a line gutter.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { BlameMargin } from '../../src/editor/BlameMargin.js';
import type { BlameResult } from '@prdm/collab';

function attribution(userId: string, receivedAt: string) {
  return { actorKind: 'user' as const, userId, onBehalfOf: null, agentId: null, receivedAt };
}

describe('BlameMargin (WO-381)', () => {
  it('renders one marker per block, each inside its own block element with the right author initial', () => {
    const source = 'First block.\n\nSecond block.';
    const blame: BlameResult = {
      lines: [
        { line: 0, attribution: attribution('ana', '2026-01-01T00:00:00Z') },
        { line: 1, attribution: null },
        { line: 2, attribution: attribution('beto', '2026-01-02T00:00:00Z') },
      ],
      fields: {},
    };
    const blocks = [
      { kind: 'paragraph' as const, from: 0, to: 12, contentFrom: 0 },
      { kind: 'paragraph' as const, from: 14, to: 27, contentFrom: 14 },
    ];

    function Harness() {
      const [container, setContainer] = useState<HTMLDivElement | null>(null);
      return (
        <div ref={setContainer}>
          <p data-block-from={0} data-block-to={12}>
            First block.
            <span data-blame-slot="" />
          </p>
          <p data-block-from={14} data-block-to={27}>
            Second block.
            <span data-blame-slot="" />
          </p>
          <BlameMargin source={source} blocks={blocks} blame={blame} container={container} />
        </div>
      );
    }

    render(<Harness />);

    const markers = screen.getAllByTestId('blame-marker');
    expect(markers).toHaveLength(2);
    expect(markers[0]!.closest('p')?.getAttribute('data-block-from')).toBe('0');
    expect(markers[0]!.getAttribute('aria-label')).toContain('ana');
    expect(markers[1]!.closest('p')?.getAttribute('data-block-from')).toBe('14');
    expect(markers[1]!.getAttribute('aria-label')).toContain('beto');
  });
});
