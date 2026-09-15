import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../../src/components/Button/Button';

describe('Button', () => {
  it('renders as a real button with the given label', () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeTruthy();
  });

  it('defaults to type="button" so it never submits a form by accident', () => {
    render(<Button>Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' }).getAttribute('type')).toBe('button');
  });

  it('defaults to the secondary variant', () => {
    render(<Button>Cancelar</Button>);
    expect(screen.getByRole('button', { name: 'Cancelar' }).className).toContain('secondary');
  });

  it('renders the primary variant', () => {
    render(<Button variant="primary">Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' }).className).toContain('primary');
  });

  it('renders the destructive variant', () => {
    render(<Button variant="destructive">Descartar borrador</Button>);
    expect(screen.getByRole('button', { name: 'Descartar borrador' }).className).toContain('destructive');
  });

  it('renders the ghost variant', () => {
    render(<Button variant="ghost">Ajustes</Button>);
    expect(screen.getByRole('button', { name: 'Ajustes' }).className).toContain('ghost');
  });

  it('applies the small size class', () => {
    render(<Button size="sm">Chico</Button>);
    expect(screen.getByRole('button', { name: 'Chico' }).className).toContain('sm');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Cerrar feature
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Cerrar feature' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('merges a caller-provided className', () => {
    render(<Button className="mi-clase">Guardar</Button>);
    expect(screen.getByRole('button', { name: 'Guardar' }).className).toContain('mi-clase');
  });

  it('grows the small size and the ghost variant to a 44px hit target below 767px', () => {
    const css = readFileSync(resolve(import.meta.dirname, '../../../src/components/Button/Button.module.css'), 'utf8');
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[^]*\.sm\s*\{[^}]*min-height:\s*var\(--hit-target\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[^]*\.ghost\s*\{[^}]*min-height:\s*var\(--hit-target\)/);
  });
});
