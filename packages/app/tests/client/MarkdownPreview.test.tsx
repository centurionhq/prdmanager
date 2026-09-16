/**
 * WO-165 — react-markdown 10.1.0, pinned via `npm view react-markdown version` at implementation time.
 * XSS payloads: a raw `<script>` tag, an `onerror` image handler, and a `javascript:` link — none may
 * execute or render as a live handler. Also covers "no remote images" and "external links get
 * rel=noopener noreferrer + full URL visible".
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MarkdownPreview } from '../../src/components/MarkdownPreview.js';

describe('MarkdownPreview — XSS payloads never execute or render as live markup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a raw <script> tag is never rendered at all (skipHtml)', () => {
    const { container } = render(<MarkdownPreview body={'before\n\n<script>window.__pwned = true;</script>\n\nafter'} />);
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(container.textContent).toContain('before');
    expect(container.textContent).toContain('after');
  });

  test('an <img onerror=...> handler is never wired up (raw HTML is skipped, not just the URL)', () => {
    const { container } = render(<MarkdownPreview body={'<img src="x" onerror="window.__pwned = true">'} />);
    expect(container.querySelector('img')).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  test('a javascript: link never gets a live href (defaultUrlTransform strips it)', () => {
    render(<MarkdownPreview body={'[click me](javascript:alert(1))'} />);
    const link = screen.getByText('click me') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).not.toMatch(/^javascript:/i);
  });

  test('a remote http(s) image never gets a live src (no remote images)', () => {
    const { container } = render(<MarkdownPreview body={'![alt text](https://evil.example.com/tracker.png)'} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // Never a truthy remote URL — the attribute is omitted entirely (not even an empty string, which
    // React itself warns could make some engines re-request the current page).
    expect(img?.getAttribute('src')).toBeFalsy();
  });

  test('a protocol-relative image URL is also blocked (still a remote host)', () => {
    const { container } = render(<MarkdownPreview body={'![alt](//evil.example.com/tracker.png)'} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBeFalsy();
  });

  test('a data: image URI is allowed (never a network request)', () => {
    const { container } = render(<MarkdownPreview body={'![alt](data:image/png;base64,AAAA)'} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  test('a same-origin relative image path is allowed', () => {
    const { container } = render(<MarkdownPreview body={'![alt](/static/logo.png)'} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/static/logo.png');
  });

  test('an ordinary external link gets rel=noopener noreferrer and its full URL as a title', () => {
    render(<MarkdownPreview body={'[docs](https://example.com/path)'} />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('title')).toBe('https://example.com/path');
    expect(link.getAttribute('href')).toBe('https://example.com/path');
  });

  test('ordinary markdown still renders normally', () => {
    render(<MarkdownPreview body={'# Title\n\nSome **bold** text.'} />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(screen.getByText('bold').tagName).toBe('STRONG');
  });

  test('GFM tables render as a real <table>, not a plain paragraph (WO-358)', () => {
    const body = ['| Kind | Count |', '| --- | --- |', '| PRD | 3 |'].join('\n');
    render(<MarkdownPreview body={body} />);

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Kind' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'PRD' })).toBeTruthy();
  });

  test('GFM task lists render real checkboxes (WO-358)', () => {
    render(<MarkdownPreview body={'- [ ] Revisión visual\n- [x] Capturas de cada vista'} />);

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]?.checked).toBe(false);
    expect(checkboxes[1]?.checked).toBe(true);
  });

  // WO-369/WO-387 (accessibility gate): `remark-gfm`'s own task-list checkbox has no accessible name at
  // all by default (axe: "Form elements must have labels", critical) — real when a task list is nested
  // deeply enough that `PreviewEditor.tsx` falls back to rendering it here as an island.
  test('GFM task-list checkboxes have an accessible name that tracks checked state', () => {
    render(<MarkdownPreview body={'- [ ] Revisión visual\n- [x] Capturas de cada vista'} />);

    expect(screen.getByRole('checkbox', { name: 'Tarea pendiente' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Tarea completada' })).toBeTruthy();
  });
});
