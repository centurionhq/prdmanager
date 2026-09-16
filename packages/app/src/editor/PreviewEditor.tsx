/**
 * Renders a live `Y.Text` as editable React DOM (SDD-014 §"Editor de vista previa"): `classifyCached`
 * (parse-cache.ts, wrapping source-map.ts's `classifyDocument`) turns the current markdown source into
 * `SourceBlock`s, editable blocks become real text nodes (never `dangerouslySetInnerHTML`), and islands
 * render read-only via the same hardened `MarkdownPreview` component the Markdown-preview panel already
 * uses (XSS-hardened `react-markdown` config — reusing it here rather than inventing a second one).
 * Re-renders on every `ytext.observe` event, whether the change came from `applySplice` (y-binding.ts),
 * another collaborator, or the Markdown tab.
 *
 * Editable when `!readOnly`: `contentEditable` lets the browser fire real `beforeinput`/composition/paste
 * events, but `usePreviewInput` (WO-377) always prevents their default action and applies the equivalent
 * edit to `ytext` instead — the browser's own DOM mutation never happens, `ytext.toString()` stays the only
 * source of truth. Composition/paste/drop handling is WO-378's.
 */
import { memo, useCallback, useEffect, useReducer, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { BlockKind, EditableRun, SourceBlock } from './source-map.js';
import { classifyCached } from './parse-cache.js';
import { runDisplayText, runPrefixLength } from './run-text.js';
import { usePreviewInput } from './use-preview-input.js';
import { usePreviewSelection } from './use-preview-selection.js';
import { useRemoteCursors } from './remote-cursors.js';
import { RemoteCursors } from './RemoteCursors.js';
import { BlameMargin } from './BlameMargin.js';
import type { BlameResult } from '@prdm/collab';
import { isSafeHref, toggleMark } from './edit-ops.js';
import { applySplice } from './y-binding.js';
import { matchMarkShortcut, Toolbar } from './Toolbar.js';
import { splitByHighlights, runIntersectsHighlight } from './comment-highlight-ranges.js';
import type { CommentHighlightRange } from '../collab/comment-highlight.js';
import { MarkdownPreview } from '../components/MarkdownPreview.js';

export interface PreviewEditorProps {
  ytext: Y.Text;
  readOnly?: boolean;
  onEditInMarkdown?: (offset: number) => void;
  /** Shared with the Markdown (CodeMirror) tab's `yCollab` plugin — same `HocuspocusProvider.awareness`
   * instance, so cursors are mutually visible across tabs (WO-380). `undefined` outside a collab context
   * (e.g. a document with no live connection at all). */
  awareness?: Awareness | null;
  /** Same data the Markdown tab's blame gutter already fetches (WO-381) — `PreviewEditor` never fetches
   * this itself, only ever renders whatever it's given. */
  blame?: BlameResult | null;
  /** Live ranges of every open comment thread (WO-381), same shape/source as
   * `../collab/comment-highlight.js`'s `resolveOpenThreadHighlights` already produces for the Markdown tab. */
  commentHighlights?: readonly CommentHighlightRange[];
  /** Absent hides "Comentar selección" entirely (WO-381) — the caller (`CollabEditor.tsx`) owns the actual
   * `POST .../comments` call, same layering as `Toolbar`'s `onApplySplice`: this component only ever
   * reports *what* was selected, never talks to the network itself. */
  onCreateComment?: (input: { startIndex: number; endIndex: number; body: string }) => void | Promise<void>;
}

const NO_HIGHLIGHTS: readonly CommentHighlightRange[] = [];

type ListGroupKind = 'bullet' | 'ordered';

interface RenderGroup {
  listGroupKind: ListGroupKind | null;
  blocks: SourceBlock[];
}

function listGroupKindOf(kind: BlockKind): ListGroupKind | null {
  if (kind === 'ordered-item') return 'ordered';
  if (kind === 'bullet-item' || kind === 'task-item') return 'bullet';
  return null;
}

function groupBlocks(blocks: readonly SourceBlock[]): readonly RenderGroup[] {
  return blocks.reduce<RenderGroup[]>((groups, block) => {
    const listGroupKind = listGroupKindOf(block.kind);
    const last = groups.at(-1);
    if (listGroupKind !== null && last && last.listGroupKind === listGroupKind) {
      return [...groups.slice(0, -1), { listGroupKind, blocks: [...last.blocks, block] }];
    }
    return [...groups, { listGroupKind, blocks: [block] }];
  }, []);
}

function useYTextVersion(ytext: Y.Text): number {
  const [version, bumpVersion] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const handleObserve = (): void => bumpVersion();
    ytext.observe(handleObserve);
    return () => ytext.unobserve(handleObserve);
  }, [ytext]);
  return version;
}

function renderHighlightedText(text: string, from: number, highlights: readonly CommentHighlightRange[], keyPrefix: string): ReactNode {
  const segments = splitByHighlights(text, from, highlights);
  if (segments.length === 1 && segments[0]!.threadId === null) return text;
  return segments.map((segment, index) =>
    segment.threadId === null ? (
      segment.text
    ) : (
      <mark key={`${keyPrefix}-${index}`} data-thread-id={segment.threadId}>
        {segment.text}
      </mark>
    ),
  );
}

function wrapIfHighlighted(node: ReactElement, run: EditableRun, highlights: readonly CommentHighlightRange[]): ReactNode {
  const threadId = runIntersectsHighlight(run.from, run.to, highlights);
  return threadId ? <mark data-thread-id={threadId}>{node}</mark> : node;
}

function renderRun(source: string, run: EditableRun, key: string, highlights: readonly CommentHighlightRange[]): ReactNode {
  const text = runDisplayText(source, run);
  switch (run.kind) {
    case 'emphasis':
      return wrapIfHighlighted(<em key={key}>{text}</em>, run, highlights);
    case 'strong':
      return wrapIfHighlighted(<strong key={key}>{text}</strong>, run, highlights);
    case 'strikethrough':
      return wrapIfHighlighted(<s key={key}>{text}</s>, run, highlights);
    case 'link':
      // `run.href` is whatever the raw markdown source's `(...)` target contains — it can reach this
      // point via the sanitized Toolbar link popover (`insertLink`, already `isSafeHref`-checked), but
      // just as easily via a `javascript:`/`data:` URL typed directly into the raw Markdown (CodeMirror)
      // tab, a pasted document, or an older/foreign edit — this render path is the one place every one of
      // those sources funnels through, so it re-checks rather than trusting the model.
      return wrapIfHighlighted(
        <a key={key} href={isSafeHref(run.href ?? '') ? run.href : '#'}>
          {text}
        </a>,
        run,
        highlights,
      );
    case 'text':
    case 'escape':
    case 'softbreak':
      return renderHighlightedText(text, run.from + runPrefixLength(run.kind), highlights, key);
  }
}

function renderRuns(source: string, runs: EditableRun[] | undefined, highlights: readonly CommentHighlightRange[]): ReactNode[] {
  return (runs ?? []).map((run, index) => renderRun(source, run, `${run.kind}-${run.from}-${run.to}-${index}`, highlights));
}

function runsEqual(a: EditableRun[] | undefined, b: EditableRun[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((run, index) => {
    const other = b[index]!;
    return run.kind === other.kind && run.from === other.from && run.to === other.to && run.href === other.href && run.labelTo === other.labelTo;
  });
}

function highlightsEqual(a: readonly CommentHighlightRange[], b: readonly CommentHighlightRange[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((range, index) => {
    const other = b[index]!;
    return range.threadId === other.threadId && range.from === other.from && range.to === other.to;
  });
}

function relevantHighlights(block: SourceBlock, highlights: readonly CommentHighlightRange[]): readonly CommentHighlightRange[] {
  return highlights.filter((range) => range.from < block.to && range.to > block.from);
}

interface BlockRenderProps {
  source: string;
  block: SourceBlock;
  highlights: readonly CommentHighlightRange[];
}

/**
 * SDD-014 perf budget (WO-384): `PreviewEditor` re-renders its whole tree on every keystroke (one edited
 * character shifts the offsets of everything downstream of it in the raw markdown `source`), so without
 * this comparator every block's rendering function — `renderRuns`, `runIntersectsHighlight`,
 * `splitByHighlights` — would re-run for every block, on every keystroke, in a ~200KB document with
 * thousands of blocks. `data-block-from`/`data-block-to` must stay perfectly in sync with `classifyCached`'s
 * current offsets (`dom-selection.ts` and `usePreviewInput.ts` resolve DOM positions back into `SourceBlock`s
 * by reading that exact attribute), so a block whose absolute offsets shifted always re-renders — only a
 * block whose `from`/`to`/`contentFrom`/content/relevant-highlights are all byte-for-byte identical to the
 * previous render is skipped. In practice that's every block *before* the edit's position, which is the
 * common case a real editing cursor produces.
 */
function blockPropsEqual(prev: BlockRenderProps, next: BlockRenderProps): boolean {
  const { block: prevBlock } = prev;
  const { block: nextBlock } = next;
  if (prevBlock.from !== nextBlock.from || prevBlock.to !== nextBlock.to || prevBlock.contentFrom !== nextBlock.contentFrom) return false;
  if (prevBlock.kind !== nextBlock.kind || prevBlock.taskChecked !== nextBlock.taskChecked || prevBlock.orderedNumber !== nextBlock.orderedNumber) return false;
  if (!runsEqual(prevBlock.runs, nextBlock.runs)) return false;
  if (prev.source.slice(prevBlock.from, prevBlock.to) !== next.source.slice(nextBlock.from, nextBlock.to)) return false;
  return highlightsEqual(relevantHighlights(prevBlock, prev.highlights), relevantHighlights(nextBlock, next.highlights));
}

// WO-387 (accessibility gate): the page's own `<h1>` is always the document's title (`DocumentDetail.tsx`,
// rendered outside this component entirely) — a document body's own top-level `# heading` rendering as a
// *second* literal `<h1>` here would break the one-`<h1>`-per-page outline every screen reader's heading
// navigation relies on. Every body heading level is shifted down by one DOM tag (`heading1` -> `<h2>`, and
// so on) so the body nests correctly *under* the page's real title instead of competing with it — the
// Markdown-source-facing "Título 1/2/3" labels in `Toolbar.tsx` are unaffected, since those describe the
// heading's level *within the document*, not its absolute HTML tag.
const HEADING_TAG: Readonly<Record<'heading1' | 'heading2' | 'heading3', 'h2' | 'h3' | 'h4'>> = {
  heading1: 'h2',
  heading2: 'h3',
  heading3: 'h4',
};

/** An always-empty leaf, one per editable block: `BlameMargin`/`RemoteCursors` portal their badges into
 * this rather than the block's own root element — React warns (and misbehaves) about portaling into a DOM
 * node that some other JSX in the same tree also assigns real children to, but a dedicated empty slot is
 * exactly the "leaf with no children" that warning asks for. Contributes no `Text` node, so it's invisible
 * to `dom-selection.ts`'s `collectTextNodes` walk. */
function MarginSlot(): ReactElement {
  return (
    <>
      <span data-blame-slot="" />
      <span data-cursor-slot="" />
    </>
  );
}

const ListItem = memo(function ListItem({ source, block, highlights }: BlockRenderProps): ReactElement {
  if (block.kind === 'task-item') {
    return (
      <li data-block-from={block.from} data-block-to={block.to}>
        <input type="checkbox" checked={block.taskChecked ?? false} readOnly aria-label="tarea completada" />
        {renderRuns(source, block.runs, highlights)}
        <MarginSlot />
      </li>
    );
  }
  return (
    <li data-block-from={block.from} data-block-to={block.to}>
      {renderRuns(source, block.runs, highlights)}
      <MarginSlot />
    </li>
  );
}, blockPropsEqual);

interface IslandBlockProps {
  source: string;
  block: SourceBlock;
  onEditInMarkdown?: (offset: number) => void;
}

function islandPropsEqual(prev: IslandBlockProps, next: IslandBlockProps): boolean {
  if (prev.block.from !== next.block.from || prev.block.to !== next.block.to) return false;
  if (prev.onEditInMarkdown !== next.onEditInMarkdown) return false;
  return prev.source.slice(prev.block.from, prev.block.to) === next.source.slice(next.block.from, next.block.to);
}

const IslandBlock = memo(function IslandBlock({ source, block, onEditInMarkdown }: IslandBlockProps): ReactElement {
  return (
    <div data-testid="island" data-block-from={block.from} data-block-to={block.to}>
      <MarkdownPreview body={source.slice(block.from, block.to)} />
      <button type="button" onClick={() => onEditInMarkdown?.(block.from)}>
        Editar en Markdown
      </button>
    </div>
  );
}, islandPropsEqual);

const Heading = memo(function Heading({ source, block, highlights }: BlockRenderProps): ReactElement {
  const Tag = HEADING_TAG[block.kind as 'heading1' | 'heading2' | 'heading3'];
  return (
    <Tag data-block-from={block.from} data-block-to={block.to}>
      {renderRuns(source, block.runs, highlights)}
      <MarginSlot />
    </Tag>
  );
}, blockPropsEqual);

const Paragraph = memo(function Paragraph({ source, block, highlights }: BlockRenderProps): ReactElement {
  return (
    <p data-block-from={block.from} data-block-to={block.to}>
      {renderRuns(source, block.runs, highlights)}
      <MarginSlot />
    </p>
  );
}, blockPropsEqual);

function renderSingleBlock(
  source: string,
  block: SourceBlock,
  highlights: readonly CommentHighlightRange[],
  onEditInMarkdown?: (offset: number) => void,
): ReactElement {
  if (block.kind === 'island') {
    return <IslandBlock key={block.from} source={source} block={block} onEditInMarkdown={onEditInMarkdown} />;
  }
  if (block.kind === 'heading1' || block.kind === 'heading2' || block.kind === 'heading3') {
    return <Heading key={block.from} source={source} block={block} highlights={highlights} />;
  }
  return <Paragraph key={block.from} source={source} block={block} highlights={highlights} />;
}

interface CapturedCommentRange {
  startIndex: number;
  endIndex: number;
}

interface CommentTriggerProps {
  onCapture: () => void;
}

/** Same reasoning as `Toolbar.tsx`'s `keepFocus`: this button lives outside the contentEditable region, so
 * preventing its own `mousedown` stops the click from collapsing the DOM selection before `onClick` runs —
 * but the offsets themselves are still captured into state right there (`useLinkPopover`'s pattern in the
 * design canvas), so the form that follows never depends on the live `window.getSelection()` staying put. */
function CommentTrigger({ onCapture }: CommentTriggerProps): ReactElement {
  return (
    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCapture}>
      Comentar selección
    </button>
  );
}

interface CommentFormProps {
  range: CapturedCommentRange;
  onCreateComment: (input: { startIndex: number; endIndex: number; body: string }) => void | Promise<void>;
  onCancel: () => void;
}

function CommentForm({ range, onCreateComment, onCancel }: CommentFormProps): ReactElement {
  const [body, setBody] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    void onCreateComment({ startIndex: range.startIndex, endIndex: range.endIndex, body: trimmed });
    setBody('');
    onCancel();
  }

  return (
    <form onSubmit={handleSubmit} onMouseDown={(event) => event.preventDefault()}>
      <label htmlFor="preview-new-comment-body">Nuevo comentario</label>
      <input id="preview-new-comment-body" type="text" value={body} onChange={(event) => setBody(event.target.value)} autoFocus />
      <button type="submit" disabled={!body.trim()}>
        Comentar
      </button>
      <button type="button" onClick={onCancel}>
        Cancelar
      </button>
    </form>
  );
}

function renderGroup(
  source: string,
  group: RenderGroup,
  highlights: readonly CommentHighlightRange[],
  onEditInMarkdown?: (offset: number) => void,
): ReactElement {
  if (group.listGroupKind === 'ordered') {
    return <ol key={group.blocks[0]!.from}>{group.blocks.map((block) => <ListItem key={block.from} source={source} block={block} highlights={highlights} />)}</ol>;
  }
  if (group.listGroupKind === 'bullet') {
    return <ul key={group.blocks[0]!.from}>{group.blocks.map((block) => <ListItem key={block.from} source={source} block={block} highlights={highlights} />)}</ul>;
  }
  return renderSingleBlock(source, group.blocks[0]!, highlights, onEditInMarkdown);
}

export function PreviewEditor({
  ytext,
  readOnly = false,
  onEditInMarkdown,
  awareness = null,
  blame = null,
  commentHighlights = NO_HIGHLIGHTS,
  onCreateComment,
}: PreviewEditorProps): ReactElement {
  useYTextVersion(ytext);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
    setContainerElement(node);
  }, []);
  usePreviewInput({ ytext, containerRef, readOnly });

  const source = ytext.toString();
  const blocks = classifyCached(ytext, source);
  const groups = groupBlocks(blocks);
  const selection = usePreviewSelection({ containerRef, blocks });
  const remoteCursors = useRemoteCursors({ ytext, awareness, containerRef, blocks });
  const [capturedCommentRange, setCapturedCommentRange] = useState<CapturedCommentRange | null>(null);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (readOnly || !selection) return;
    const mark = matchMarkShortcut(event);
    if (!mark) return;
    event.preventDefault();
    const splice = toggleMark(selection.block, selection.from, selection.to, mark, source);
    if (splice) applySplice(ytext, splice);
  }

  return (
    <>
      {!readOnly && <Toolbar source={source} activeBlock={selection?.block ?? null} selectionRange={selection} onApplySplice={(splice) => applySplice(ytext, splice)} />}
      {!readOnly && capturedCommentRange && onCreateComment && (
        <CommentForm range={capturedCommentRange} onCreateComment={onCreateComment} onCancel={() => setCapturedCommentRange(null)} />
      )}
      {!readOnly && !capturedCommentRange && selection && selection.from !== selection.to && onCreateComment && (
        <CommentTrigger
          onCapture={() =>
            setCapturedCommentRange({ startIndex: selection.block.contentFrom + selection.from, endIndex: selection.block.contentFrom + selection.to })
          }
        />
      )}
      {/* WO-387 (accessibility gate): a bare `contentEditable` div with block children (`h2`/`p`/`li`) has
          no reliable accessible name across browsers/AT, and its implicit HTML-AAM role isn't computed at
          all by the jsdom-based unit tests this repo runs — an explicit `role="textbox"`/`aria-multiline`
          (the same pair every mainstream native-contentEditable rich-text editor ships, e.g. Draft.js's
          `DraftEditor`) plus a real `aria-label` is what actually announces "editable document region" to
          a screen reader instead of an unlabeled, unannounced blob of static-looking text. */}
      <div
        ref={attachContainer}
        data-testid="preview-editor"
        role="textbox"
        aria-multiline="true"
        aria-label="Cuerpo del documento"
        aria-readonly={readOnly}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
      >
        {groups.map((group) => renderGroup(source, group, commentHighlights, onEditInMarkdown))}
        <RemoteCursors markers={remoteCursors} container={containerElement} />
        <BlameMargin source={source} blocks={blocks} blame={blame} container={containerElement} />
      </div>
    </>
  );
}
