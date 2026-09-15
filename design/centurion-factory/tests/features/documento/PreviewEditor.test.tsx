import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DocumentBlock } from '../../../src/data';
import { PreviewEditor } from '../../../src/features/documento/PreviewEditor';

function noop(): void {}

function renderPreview(blocks: readonly DocumentBlock[]) {
  return render(
    <PreviewEditor
      blocks={blocks}
      onFocusBlock={noop}
      onBlurBlock={noop}
      onChangeText={noop}
      onToggleChecked={noop}
      onFormatShortcut={noop}
      onSelectionChange={noop}
      onSplitBlock={noop}
      onMergeWithPrevious={noop}
      onPasteText={noop}
      registerField={noop}
    />,
  );
}

describe('PreviewEditor: the task checkbox accessible name strips markdown formatting', () => {
  it('uses plain text in the aria-label instead of the raw **bold**/_italic_ markers', () => {
    const blocks: DocumentBlock[] = [{ id: 'b1', type: 'task', text: '**Revisar** el _informe_ final', author: 'ana-rios', checked: false }];
    renderPreview(blocks);

    expect(screen.getByRole('checkbox', { name: 'Tarea: Revisar el informe final' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /\*\*/ })).toBeNull();
  });

  it('wraps the checkbox in a hit-area container sized for a 44px mobile touch target', () => {
    const blocks: DocumentBlock[] = [{ id: 'b1', type: 'task', text: 'Tarea simple', author: 'ana-rios', checked: false }];
    renderPreview(blocks);

    const checkbox = screen.getByRole('checkbox', { name: 'Tarea: Tarea simple' });
    expect(checkbox.closest('[class*="checkboxHitArea"]')).toBeTruthy();
  });
});
