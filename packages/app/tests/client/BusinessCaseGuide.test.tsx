/**
 * WO-562 (SDD-053/PRD-033 R2): the writing guide next to the editor. Like `FrontmatterForm.test.tsx`, the
 * collab context is faked with a real local `Y.Doc`, so every read of the live body is a real Yjs read --
 * what is being tested is that the guide tracks what the person is actually writing, section by section.
 */
import { act, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BC_REQUIRED_SECTIONS } from '@prdm/core/domain';
import * as collabContext from '../../src/collab/collab-document-context.js';
import { BusinessCaseGuide } from '../../src/routes/documento/BusinessCaseGuide.js';

const EMPTY_TEMPLATE = `${BC_REQUIRED_SECTIONS.join('\n\n')}\n`;

function renderGuide(body: string): Y.Doc {
  const ydoc = new Y.Doc({ gc: false });
  ydoc.getText('body').insert(0, body);
  vi.spyOn(collabContext, 'useCollabDocumentContext').mockReturnValue({
    provider: { document: ydoc, awareness: null } as never,
    state: { status: 'connected', synced: true, scope: 'read-write', presence: [] },
    orgSlug: 'acme',
    projectSlug: 'web',
    docId: 'BC-014',
    editorView: null,
    setEditorView: () => {},
  });
  render(<BusinessCaseGuide />);
  return ydoc;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BusinessCaseGuide (WO-562, SDD-053)', () => {
  it('lists the four required sections in order, each in plain words with what is expected there', () => {
    renderGuide(EMPTY_TEMPLATE);

    const guide = screen.getByRole('complementary', { name: 'Guía del caso de negocio' });
    const items = within(guide).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toContain('El problema');
    expect(items[0]?.textContent).toContain('Qué duele hoy y a quién');
    expect(items[1]?.textContent).toContain('Qué cambia si lo hacemos');
    expect(items[2]?.textContent).toContain('Cómo sabremos que funcionó');
    expect(items[3]?.textContent).toContain('Cuánto cuesta');
  });

  it('a freshly created document counts zero written, even though the template already has the four headings', () => {
    renderGuide(EMPTY_TEMPLATE);

    expect(screen.getByText('0 de 4 escritas')).toBeTruthy();
  });

  it('counts a section as written once there is something under its heading', () => {
    renderGuide('## Problema\n\nNadie se entera del atraso.\n\n## Impacto esperado\n\nSe ve el mismo día.\n\n## Métrica de éxito\n\n## Costo estimado\n');

    expect(screen.getByText('2 de 4 escritas')).toBeTruthy();
    const guide = screen.getByRole('complementary', { name: 'Guía del caso de negocio' });
    const items = within(guide).getAllByRole('listitem');
    expect(items[0]?.getAttribute('data-escrita')).toBe('true');
    expect(items[2]?.getAttribute('data-escrita')).toBe('false');
  });

  it('whitespace under a heading is not something written', () => {
    renderGuide('## Problema\n\n   \n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n');

    expect(screen.getByText('0 de 4 escritas')).toBeTruthy();
  });

  it('points at the first one still missing, so the guide always says where to go next', () => {
    renderGuide('## Problema\n\nAlgo.\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n');

    const items = within(screen.getByRole('complementary', { name: 'Guía del caso de negocio' })).getAllByRole('listitem');
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(items.filter((item) => item.getAttribute('aria-current') === 'step')).toHaveLength(1);
  });

  it('once the four are written nothing is pointed at, and it says so', () => {
    renderGuide(BC_REQUIRED_SECTIONS.map((heading) => `${heading}\n\nAlgo.\n`).join('\n'));

    expect(screen.getByText('4 de 4 escritas')).toBeTruthy();
    const items = within(screen.getByRole('complementary', { name: 'Guía del caso de negocio' })).getAllByRole('listitem');
    expect(items.every((item) => item.getAttribute('aria-current') === null)).toBe(true);
  });

  it('follows the document as it is written, without a reload', () => {
    const ydoc = renderGuide(EMPTY_TEMPLATE);
    expect(screen.getByText('0 de 4 escritas')).toBeTruthy();

    act(() => {
      const body = ydoc.getText('body');
      body.insert(body.toString().indexOf('## Impacto esperado'), 'Nadie se entera del atraso.\n\n');
    });

    expect(screen.getByText('1 de 4 escritas')).toBeTruthy();
  });

  it('says what publishing unlocks, while there is still time to care', () => {
    renderGuide(EMPTY_TEMPLATE);

    const guide = screen.getByRole('complementary', { name: 'Guía del caso de negocio' });
    expect(within(guide).getByText(/queda aprobada/).textContent).toContain('requisitos');
  });

  it('a section renamed in the document is simply not written yet: the guide never invents its own list', () => {
    renderGuide('## El problema\n\nNadie se entera.\n\n## Impacto esperado\n\n## Métrica de éxito\n\n## Costo estimado\n');

    expect(screen.getByText('0 de 4 escritas')).toBeTruthy();
  });
});
