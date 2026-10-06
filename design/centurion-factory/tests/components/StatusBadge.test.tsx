import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
      ['archived', 'Archivada'],
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

  it('uses --senal-texto (not --senal, which fails AA on acero) for the senal tone text color', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../src/components/StatusBadge/StatusBadge.module.css'), 'utf8');
    expect(css).toMatch(/\.toneSenal\s*\{[^}]*color:\s*var\(--senal-texto\)/);
    expect(css).toMatch(/\.markSenal\s*\{[^}]*background:\s*var\(--senal\)/);
  });
});
