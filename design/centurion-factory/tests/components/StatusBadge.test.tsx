import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '../../src/components/StatusBadge/StatusBadge';

describe('StatusBadge', () => {
  describe('workflow', () => {
    it.each([
      ['draft', 'Borrador'],
      ['in_review', 'En revisión'],
      ['published', 'Publicado'],
      ['archived', 'Archivado'],
    ] as const)('labels %s as %s', (status, label) => {
      render(<StatusBadge kind="workflow" status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
    });
  });

  describe('workOrder', () => {
    it.each([
      ['pending', 'Pendiente'],
      ['in_progress', 'En curso'],
      ['out_of_sync', 'Fuera de sincronía'],
      ['done', 'Hecha'],
    ] as const)('labels %s as %s', (status, label) => {
      render(<StatusBadge kind="workOrder" status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
    });
  });

  describe('feature', () => {
    it.each([
      ['draft', 'Borrador'],
      ['proposed', 'Propuesta'],
      ['approved', 'Aprobada'],
      ['closed', 'Cerrada'],
    ] as const)('labels %s as %s', (status, label) => {
      render(<StatusBadge kind="feature" status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
    });
  });

  it('renders a decorative mark that is hidden from assistive tech', () => {
    const { container } = render(<StatusBadge kind="workOrder" status="done" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
