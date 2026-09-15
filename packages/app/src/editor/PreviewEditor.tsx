/**
 * Renders a live `Y.Text` as editable React DOM (SDD-014 §"Editor de vista previa"): `classifyDocument`
 * (source-map.ts) turns the current markdown source into `SourceBlock`s, editable blocks become real text
 * nodes (never `dangerouslySetInnerHTML`), and islands render read-only via the same hardened
 * `MarkdownPreview` component the Markdown-preview panel already uses (XSS-hardened `react-markdown`
 * config — reusing it here rather than inventing a second one). Re-renders on every `ytext.observe` event,
 * whether the change came from `applySplice` (y-binding.ts), another collaborator, or the Markdown tab.
 *
 * Input handling (`beforeinput`, composition, paste) is a separate WO by design — this component is
 * render-only.
 */
import { useEffect, useReducer, type ReactElement, type ReactNode } from 'react';
import * as Y from 'yjs';
import { classifyDocument, type BlockKind, type EditableRun, type SourceBlock } from './source-map.js';
import { runDisplayText } from './run-text.js';
import { MarkdownPreview } from '../components/MarkdownPreview.js';

export interface PreviewEditorProps {
  ytext: Y.Text;
  readOnly?: boolean;
  onEditInMarkdown?: (offset: number) => void;
}

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

function renderRun(source: string, run: EditableRun, key: string): ReactNode {
  const text = runDisplayText(source, run);
  switch (run.kind) {
    case 'emphasis':
      return <em key={key}>{text}</em>;
    case 'strong':
      return <strong key={key}>{text}</strong>;
    case 'strikethrough':
      return <s key={key}>{text}</s>;
    case 'link':
      return (
        <a key={key} href={run.href}>
          {text}
        </a>
      );
    case 'text':
    case 'escape':
    case 'softbreak':
      return text;
  }
}

function renderRuns(source: string, runs: EditableRun[] | undefined): ReactNode[] {
  return (runs ?? []).map((run, index) => renderRun(source, run, `${run.kind}-${run.from}-${run.to}-${index}`));
}

const HEADING_TAG: Readonly<Record<'heading1' | 'heading2' | 'heading3', 'h1' | 'h2' | 'h3'>> = {
  heading1: 'h1',
  heading2: 'h2',
  heading3: 'h3',
};

function renderListItem(source: string, block: SourceBlock): ReactElement {
  if (block.kind === 'task-item') {
    return (
      <li key={block.from} data-block-from={block.from} data-block-to={block.to}>
        <input type="checkbox" checked={block.taskChecked ?? false} readOnly aria-label="tarea completada" />
        {renderRuns(source, block.runs)}
      </li>
    );
  }
  return (
    <li key={block.from} data-block-from={block.from} data-block-to={block.to}>
      {renderRuns(source, block.runs)}
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

function renderSingleBlock(source: string, block: SourceBlock, onEditInMarkdown?: (offset: number) => void): ReactElement {
  if (block.kind === 'island') {
    return <IslandBlock key={block.from} source={source} block={block} onEditInMarkdown={onEditInMarkdown} />;
  }
  if (block.kind === 'heading1' || block.kind === 'heading2' || block.kind === 'heading3') {
    const Tag = HEADING_TAG[block.kind];
    return (
      <Tag key={block.from} data-block-from={block.from} data-block-to={block.to}>
        {renderRuns(source, block.runs)}
      </Tag>
    );
  }
  return (
    <p key={block.from} data-block-from={block.from} data-block-to={block.to}>
      {renderRuns(source, block.runs)}
    </p>
  );
}

function renderGroup(source: string, group: RenderGroup, onEditInMarkdown?: (offset: number) => void): ReactElement {
  if (group.listGroupKind === 'ordered') {
    return <ol key={group.blocks[0]!.from}>{group.blocks.map((block) => renderListItem(source, block))}</ol>;
  }
  if (group.listGroupKind === 'bullet') {
    return <ul key={group.blocks[0]!.from}>{group.blocks.map((block) => renderListItem(source, block))}</ul>;
  }
  return renderSingleBlock(source, group.blocks[0]!, onEditInMarkdown);
}

export function PreviewEditor({ ytext, readOnly = false, onEditInMarkdown }: PreviewEditorProps): ReactElement {
  useYTextVersion(ytext);
  const source = ytext.toString();
  const blocks = classifyDocument(source);
  const groups = groupBlocks(blocks);

  return (
    <div data-testid="preview-editor" aria-readonly={readOnly}>
      {groups.map((group) => renderGroup(source, group, onEditInMarkdown))}
    </div>
  );
}
