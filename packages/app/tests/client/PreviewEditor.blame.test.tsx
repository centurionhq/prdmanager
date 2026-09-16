/**
 * WO-381 — `PreviewEditor` renders a `BlameMargin` badge per block when given a `blame` prop, using the
 * same `BlameResult` the Markdown tab's gutter already fetches.
 */
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { PreviewEditor } from '../../src/editor/PreviewEditor.js';
import type { BlameResult } from '@prdm/collab';

function docWithBody(body: string): Y.Text {
  const ydoc = new Y.Doc({ gc: false });
  const ytext = ydoc.getText('body');
  ytext.insert(0, body);
  return ytext;
}

describe('PreviewEditor blame margin (WO-381)', () => {
  it('shows a blame marker for a block with attribution, inside that block', () => {
    const ytext = docWithBody('Only paragraph.');
    const blame: BlameResult = {
      lines: [{ line: 0, attribution: { actorKind: 'user', userId: 'ana', onBehalfOf: null, agentId: null, receivedAt: '2026-01-01T00:00:00Z' } }],
      fields: {},
    };

    render(<PreviewEditor ytext={ytext} blame={blame} />);

    const marker = screen.getByTestId('blame-marker');
    expect(marker.closest('p[data-block-from]')).toBeTruthy();
    expect(marker.getAttribute('aria-label')).toContain('ana');
  });

  it('shows no blame marker without a blame prop', () => {
    const ytext = docWithBody('Only paragraph.');
    render(<PreviewEditor ytext={ytext} />);
    expect(screen.queryByTestId('blame-marker')).toBeNull();
  });
});
