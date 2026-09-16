/**
 * WO-381 — `PreviewEditor` highlights the live ranges of every currently open comment thread it's given,
 * the same visual affordance `../collab/comment-highlight.ts` already gives the Markdown (CodeMirror) tab.
 */
import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { PreviewEditor } from '../../src/editor/PreviewEditor.js';

function docWithBody(body: string): Y.Text {
  const ydoc = new Y.Doc({ gc: false });
  const ytext = ydoc.getText('body');
  ytext.insert(0, body);
  return ytext;
}

describe('PreviewEditor comment highlights (WO-381)', () => {
  it('wraps the highlighted plain-text range in a <mark> tagged with the thread id', () => {
    const source = 'hello world';
    const ytext = docWithBody(source);
    const from = source.indexOf('world');
    const to = from + 'world'.length;

    render(<PreviewEditor ytext={ytext} commentHighlights={[{ threadId: 'thread-1', from, to }]} />);

    const mark = screen.getByText('world');
    expect(mark.tagName).toBe('MARK');
    expect(mark.getAttribute('data-thread-id')).toBe('thread-1');
  });

  it('renders no <mark> when there are no highlights', () => {
    const ytext = docWithBody('hello world');
    render(<PreviewEditor ytext={ytext} />);
    expect(document.querySelector('mark')).toBeNull();
  });
});
