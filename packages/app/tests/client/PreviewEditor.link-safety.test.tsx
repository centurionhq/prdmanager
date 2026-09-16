/**
 * WO-370/WO-386 security gate finding: `PreviewEditor.tsx`'s link-run renderer rendered `run.href`
 * verbatim as a real `<a href>`, with no scheme check — unlike `MarkdownPreview.tsx`'s island rendering
 * (react-markdown's own `urlTransform`/`defaultUrlTransform`) and unlike `edit-ops.ts`'s `insertLink`
 * (the Toolbar link popover's own `isSafeHref` guard), which only protects edits made *through* the
 * popover. A `javascript:`/`data:` link typed directly into the raw Markdown (CodeMirror) tab, pasted in,
 * or synced from another collaborator's edit reached the DOM as a real, clickable `javascript:` href.
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

describe('PreviewEditor link rendering safety', () => {
  it('never renders a javascript: href reached via raw markdown, even though insertLink never ran', () => {
    const ytext = docWithBody("Click [here](javascript:document.title='pwned') now.");

    render(<PreviewEditor ytext={ytext} />);

    const link = screen.getByText('here');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('#');
    expect(link.getAttribute('href')).not.toContain('javascript:');
  });

  it('never renders a data: href reached via raw markdown', () => {
    const ytext = docWithBody('Click [here](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==) now.');

    render(<PreviewEditor ytext={ytext} />);

    const link = screen.getByText('here');
    expect(link.getAttribute('href')).toBe('#');
  });

  it('still renders a same-origin, https:// and mailto: href unchanged', () => {
    const ytext = docWithBody(
      ['[a](https://example.test/path)', '', '[b](mailto:person@example.test)', '', '[c](/o/acme/p/factory)'].join('\n\n'),
    );

    render(<PreviewEditor ytext={ytext} />);

    expect(screen.getByText('a').getAttribute('href')).toBe('https://example.test/path');
    expect(screen.getByText('b').getAttribute('href')).toBe('mailto:person@example.test');
    expect(screen.getByText('c').getAttribute('href')).toBe('/o/acme/p/factory');
  });
});
