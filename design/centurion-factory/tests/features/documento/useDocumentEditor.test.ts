import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { serializeBlocks } from '../../../src/features/documento/markdown';
import { useDocumentEditor } from '../../../src/features/documento/useDocumentEditor';

const NOW = new Date('2026-09-15T10:00:00.000Z');

describe('useDocumentEditor: the Markdown draft is reconciled before save', () => {
  it('save() while on the Markdown tab keeps the draft, not the stale pre-edit blocks', () => {
    const { result } = renderHook(() => useDocumentEditor('SDD-011', NOW));

    const blocksBefore = result.current.blocks.length;
    const versionsBefore = result.current.versions.length;

    act(() => result.current.setEditorMode('markdown'));
    const draft = serializeBlocks(result.current.blocks);
    act(() => result.current.setMarkdownDraft(`${draft}\n\nNueva línea agregada desde Markdown.`));

    act(() => result.current.save());

    expect(result.current.blocks.length).toBe(blocksBefore + 1);
    expect(result.current.blocks.at(-1)?.text).toBe('Nueva línea agregada desde Markdown.');
    expect(result.current.versions.length).toBe(versionsBefore + 1);
  });
});

describe('useDocumentEditor: acceptProposal reconciles the draft before its stale check', () => {
  it('treats a proposal as stale once the Markdown draft edits the very line it targets, keeping the edit', () => {
    const { result } = renderHook(() => useDocumentEditor('SDD-011', NOW));

    act(() => result.current.setEditorMode('markdown'));
    const editedDraft = serializeBlocks(result.current.blocks).replace(
      '- [ ] Revisión visual manual en mobile',
      '- [ ] Revisión visual manual en mobile, ya actualizada',
    );
    act(() => result.current.setMarkdownDraft(editedDraft));

    let outcome: ReturnType<typeof result.current.acceptProposal> | undefined;
    act(() => {
      outcome = result.current.acceptProposal('prop-001');
    });

    expect(outcome?.stale).toBe(true);
    const targetBlock = result.current.blocks.find((block) => block.text.startsWith('Revisión visual manual en mobile'));
    expect(targetBlock?.text).toBe('Revisión visual manual en mobile, ya actualizada');
  });
});
