/**
 * Markdown preview (SDD-008 §"Editor"): renders `projectDoc(ydoc).body` via `react-markdown` 10.1.0,
 * hardened against the exact XSS surface a Markdown body can smuggle:
 *
 * - `skipHtml`: raw HTML in the source is never passed through (a `<script>`/`<img onerror>` tag is
 *   dropped entirely, never rendered as live markup a browser could execute).
 * - A custom `urlTransform` (react-markdown 10's replacement for the older `transformImageUri`/
 *   `transformLinkUri` props — confirmed against the installed version's own types/source, since this API
 *   changed across major versions) blocks every remote image `src` (only a `data:` URI or a same-origin
 *   relative path is allowed) while still using the library's own `defaultUrlTransform` for links, which
 *   already strips `javascript:`/other unsafe protocols on its own.
 * - Every link gets `rel="noopener noreferrer"` and its full URL as a `title` attribute (SDD-008: "URLs
 *   completas visibles" — a title attribute satisfies this without cluttering the rendered text).
 *
 * `remark-gfm` (WO-358): tables, task lists and strikethrough render correctly instead of as plain
 * paragraphs — this preview is the temporary read-only bridge `SDD-013` §"Vista previa" describes until
 * the lossless block editor (ADR-009/SDD-014) replaces it.
 *
 * WO-369/WO-387 (accessibility gate): `remark-gfm`'s own task-list checkboxes render as a bare
 * `<input type="checkbox" disabled>` with no accessible name at all (axe's "Form elements must have
 * labels" — critical impact) — this shows up here whenever a task list is too structurally complex for
 * `PreviewEditor.tsx`'s own editable task-item rendering and falls back to an `IslandBlock` using this
 * component instead. The `input` override below is the one place every task-list checkbox from either
 * path renders through.
 */
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactElement } from 'react';

interface UrlTransformNode {
  tagName: string;
}

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const DATA_URI_PATTERN = /^data:/i;

function urlTransform(url: string, _key: string, node: UrlTransformNode): string | undefined {
  if (node.tagName === 'img') {
    if (DATA_URI_PATTERN.test(url)) return url;
    // `undefined` (never `''`) for a blocked image: React itself warns that an empty-string `src` can
    // make some engines re-request the current page — omitting the attribute entirely is the safe way
    // to render "no image" (confirmed against the installed react-markdown/React versions' own warning).
    if (url.startsWith('//')) return undefined; // protocol-relative — still a remote host
    if (SCHEME_PATTERN.test(url)) return undefined; // any explicit non-data scheme (http, https, ...)
    return url; // no scheme at all: a same-origin relative path
  }
  return defaultUrlTransform(url);
}

const components: Components = {
  a: ({ href, children, ...rest }) => (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer" title={href}>
      {children}
    </a>
  ),
  input: ({ type, checked, ...rest }) =>
    type === 'checkbox' ? (
      <input {...rest} type="checkbox" checked={checked} aria-label={checked ? 'Tarea completada' : 'Tarea pendiente'} />
    ) : (
      <input {...rest} type={type} checked={checked} />
    ),
};

export interface MarkdownPreviewProps {
  body: string;
}

export function MarkdownPreview({ body }: MarkdownPreviewProps): ReactElement {
  return (
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
      {body}
    </ReactMarkdown>
  );
}
