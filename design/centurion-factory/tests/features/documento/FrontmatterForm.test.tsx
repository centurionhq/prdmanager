import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getDocument } from '../../../src/data';
import { FrontmatterForm } from '../../../src/features/documento/FrontmatterForm';

describe('FrontmatterForm: "Rutas impactadas" chips never overlap on long paths', () => {
  it('gives each chip a title with the full path, for the truncated/ellipsis case', () => {
    const document = getDocument('SDD-011');
    if (!document) throw new Error('fixture missing: SDD-011');

    render(<FrontmatterForm document={document} workflowState={document.workflowState} architectOf={undefined} latestVersion={undefined} />);

    const chip = screen.getByText('design/centurion-factory/src/**');
    expect(chip.getAttribute('title')).toBe('design/centurion-factory/src/**');
  });
});
