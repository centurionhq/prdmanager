import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IdTag } from '../../src/components/IdTag/IdTag';

describe('IdTag', () => {
  it('renders the id text in mono style', () => {
    render(<IdTag id="WO-304" />);
    const tag = screen.getByText('WO-304');
    expect(tag.className).toContain('id');
  });

  it('defaults to the blueprint tone for SDD ids', () => {
    render(<IdTag id="SDD-012" />);
    expect(screen.getByText('SDD-012').className).toContain('blueprint');
  });

  it('defaults to the blueprint tone for ADR ids', () => {
    render(<IdTag id="ADR-007" />);
    expect(screen.getByText('ADR-007').className).toContain('blueprint');
  });

  it('does not use the blueprint tone for other kinds of id', () => {
    render(<IdTag id="WO-304" />);
    expect(screen.getByText('WO-304').className).not.toContain('blueprint');
  });

  it('lets an explicit tone override the automatic detection', () => {
    render(<IdTag id="SDD-012" tone="muted" />);
    const tag = screen.getByText('SDD-012');
    expect(tag.className).toContain('muted');
    expect(tag.className).not.toContain('blueprint');
  });
});
