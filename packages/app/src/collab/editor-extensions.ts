/**
 * CodeMirror 6 extensions for the collaborative body editor (SDD-008 §"Editor"): `yCollab` binds the
 * view to the live `Y.Text`, `markdown()` gives Markdown syntax highlighting without any rich-text
 * transformation (SDD-008 §"Representación del documento": editing the raw text is what keeps `##
 * Tareas`/drift hashes intact), and the CSP nonce (WO-108/SDD-008) lets CodeMirror's own injected
 * `<style>` elements pass the page's `style-src 'nonce-...'` policy.
 */
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { markdown, markdownKeymap } from '@codemirror/lang-markdown';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { blameGutterExtension } from './blame-gutter.js';
import { commentHighlightExtension } from './comment-highlight.js';

export interface BuildEditorExtensionsOptions {
  provider: HocuspocusProvider;
  readOnly: boolean;
  /** Read from `<meta name="csp-nonce">` (`index.html`, injected per-request by `packages/server`'s
   * `spa-html.ts`) — `null` in a test/dev environment that never went through that server response. */
  cspNonce: string | null;
}

export function buildEditorExtensions(opts: BuildEditorExtensionsOptions): Extension[] {
  const { provider, readOnly, cspNonce } = opts;
  const ytext = provider.document.getText('body');
  const undoManager = new Y.UndoManager(ytext);

  const extensions: Extension[] = [
    EditorView.lineWrapping,
    markdown(),
    keymap.of([...yUndoManagerKeymap, ...markdownKeymap]),
    yCollab(ytext, provider.awareness, { undoManager }),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    blameGutterExtension,
    commentHighlightExtension,
  ];
  if (cspNonce) extensions.push(EditorView.cspNonce.of(cspNonce));
  return extensions;
}

export function readCspNonce(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="csp-nonce"]')?.getAttribute('content') || null;
}
