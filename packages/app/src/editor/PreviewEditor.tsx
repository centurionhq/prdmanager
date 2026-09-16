/**
 * Renders a live `Y.Text` as editable React DOM (SDD-014 §"Editor de vista previa"): `classifyDocument`
 * (source-map.ts) turns the current markdown source into `SourceBlock`s, editable blocks become real text
 * nodes (never `dangerouslySetInnerHTML`), and islands render read-only via the same hardened
 * `MarkdownPreview` component the Markdown-preview panel already uses (XSS-hardened `react-markdown`
 * config — reusing it here rather than inventing a second one). Re-renders on every `ytext.observe` event,
 * whether the change came from `applySplice` (y-binding.ts), another collaborator, or the Markdown tab.
 *
 * Editable when `!readOnly`: `contentEditable` lets the browser fire real `beforeinput`/composition/paste
 * events, but `usePreviewInput` (WO-377) always prevents their default action and applies the equivalent
 * edit to `ytext` instead — the browser's own DOM mutation never happens, `ytext.toString()` stays the only
 * source of truth. Composition/paste/drop handling is WO-378's.
 */
import { useEffect, useReducer, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import { classifyDocument, type BlockKind, type EditableRun, type SourceBlock } from './source-map.js';
import { runDisplayText, runPrefixLength } from './run-text.js';
import { usePreviewInput } from './use-preview-input.js';
import { usePreviewSelection } from './use-preview-selection.js';
import { useRemoteCursors } from './remote-cursors.js';
import { RemoteCursors } from './RemoteCursors.js';
import { BlameMargin } from './BlameMargin.js';
import type { BlameResult } from '@prdm/collab';
import { toggleMark } from './edit-ops.js';
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
      return wrapIfHighlighted(
        <a key={key} href={run.href}>
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

const HEADING_TAG: Readonly<Record<'heading1' | 'heading2' | 'heading3', 'h1' | 'h2' | 'h3'>> = {
  heading1: 'h1',
  heading2: 'h2',
  heading3: 'h3',
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

function renderListItem(source: string, block: SourceBlock, highlights: readonly CommentHighlightRange[]): ReactElement {
  if (block.kind === 'task-item') {
    return (
      <li key={block.from} data-block-from={block.from} data-block-to={block.to}>
        <input type="checkbox" checked={block.taskChecked ?? false} readOnly aria-label="tarea completada" />
        {renderRuns(source, block.runs, highlights)}
        <MarginSlot />
      </li>
    );
  }
  return (
    <li key={block.from} data-block-from={block.from} data-block-to={block.to}>
      {renderRuns(source, block.runs, highlights)}
      <MarginSlot />
    </li>
  );
}

function IslandBlock({ source, block, onEditInMarkdown }: { source: string; block: SourceBlock; onEditInMarkdown?: (offset: number) => void }): ReactElement {
  return (
    <div data-testid="island" data-block-from={block.from} data-block-to={block.to}>
      <MarkdownPreview body={source.slice(block.from, block.to)} />
      <button type="button" onClick={() => onEditInMarkdown?.(block.from)}>
        Editar en Markdown
      </button>
    </div>
  );
}

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
    const Tag = HEADING_TAG[block.kind];
    return (
      <Tag key={block.from} data-block-from={block.from} data-block-to={block.to}>
        {renderRuns(source, block.runs, highlights)}
        <MarginSlot />
      </Tag>
    );
  }
  return (
    <p key={block.from} data-block-from={block.from} data-block-to={block.to}>
      {renderRuns(source, block.runs, highlights)}
      <MarginSlot />
    </p>
  );
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
    return <ol key={group.blocks[0]!.from}>{group.blocks.map((block) => renderListItem(source, block, highlights))}</ol>;
  }
  if (group.listGroupKind === 'bullet') {
    return <ul key={group.blocks[0]!.from}>{group.blocks.map((block) => renderListItem(source, block, highlights))}</ul>;
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
  usePreviewInput({ ytext, containerRef, readOnly });

  const source = ytext.toString();
  const blocks = classifyDocument(source);
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
      <div
        ref={containerRef}
        data-testid="preview-editor"
        aria-readonly={readOnly}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
      >
        {groups.map((group) => renderGroup(source, group, commentHighlights, onEditInMarkdown))}
        <RemoteCursors markers={remoteCursors} containerRef={containerRef} />
        <BlameMargin source={source} blocks={blocks} blame={blame} containerRef={containerRef} />
      </div>
    </>
  );
}
