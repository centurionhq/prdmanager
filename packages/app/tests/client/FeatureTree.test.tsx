import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '@prdm/core';
import { FeatureTree } from '../../src/components/FeatureTree/FeatureTree.js';

/**
 * WO-751 (SDD-105 D5/D6, decisiones T2/T3/T4 de prdm-pm): el maestro corta el título a dos líneas con CSS
 * y ofrece el texto completo en el `title` de la fila, sin degradar el nombre accesible del treeitem; la
 * sangría se topea a cuatro niveles con el nivel real en `aria-level`; y el punto de drift suma texto
 * accesible en vez de ser el único portador.
 */

function feature(ref: string, title: string, children: TreeNode[] = []): TreeNode {
  return { ref, label: 'Feature', kind: ref.split('-')[0] ?? null, title, status: 'approved', via: null, edgeStatus: null, reviewNeeded: false, repeated: false, children };
}

function renderTree(forest: readonly TreeNode[], overrides: { readonly driftRefs?: ReadonlySet<string> } = {}): void {
  render(
    <FeatureTree
      forest={forest}
      selectedRef={forest[0]?.ref ?? ''}
      driftRefs={overrides.driftRefs ?? new Set()}
      orphanRefs={new Set()}
      collapseSignal={0}
      onSelect={vi.fn()}
    />,
  );
}

const LONG_MARKDOWN_TITLE = '**Árbol**: el panel de `packages/app/src/routes/ProjectGraph.tsx` dice lo que muestra';

describe('FeatureTree · títulos legibles (WO-751)', () => {
  it('ofrece el texto completo y plano en el `title` de la fila (T2)', () => {
    renderTree([feature('FR-009', LONG_MARKDOWN_TITLE)]);

    const row = screen.getByRole('treeitem', { name: /FR-009/ });
    expect(row.getAttribute('title')).toBe('Árbol: el panel de packages/app/src/routes/ProjectGraph.tsx dice lo que muestra');
    // El corte es CSS: el texto completo sigue en el DOM, así el nombre accesible no se degrada (D6).
    expect(screen.getByRole('treeitem', { name: /dice lo que muestra$/ })).toBe(row);
  });

  it('no corta el nombre accesible del treeitem cuando el título es largo', () => {
    renderTree([feature('FR-009', LONG_MARKDOWN_TITLE)]);

    const row = screen.getByRole('treeitem', { name: /FR-009/ });
    expect(row.textContent).toContain('dice lo que muestra');
    expect(row.textContent).toContain('ProjectGraph.tsx');
  });

  it('deja el título en texto plano en el `title`, sin backticks ni asteriscos', () => {
    renderTree([feature('FR-009', LONG_MARKDOWN_TITLE)]);

    const title = screen.getByRole('treeitem', { name: /FR-009/ }).getAttribute('title') ?? '';
    expect(title).not.toContain('`');
    expect(title).not.toContain('*');
  });
});

describe('FeatureTree · sangría topeada (WO-751, T3)', () => {
  const deep = feature('FR-006', 'Nivel seis', []);
  const forest = [
    feature('MRD-001', 'Nivel uno', [
      feature('PRD-001', 'Nivel dos', [feature('BC-001', 'Nivel tres', [feature('BC-002', 'Nivel cuatro', [feature('PRD-002', 'Nivel cinco', [deep])])])]),
    ]),
  ];

  it('topea la sangría a cuatro niveles pero conserva el nivel real en aria-level', () => {
    renderTree(forest);

    const row = screen.getByRole('treeitem', { name: /FR-006/ });
    expect(row.getAttribute('aria-level')).toBe('6');
    expect(Number(row.style.getPropertyValue('--depth'))).toBe(4);
  });

  it('no cambia la sangría de los niveles que no llegan al tope', () => {
    renderTree(forest);

    expect(Number(screen.getByRole('treeitem', { name: /BC-001/ }).style.getPropertyValue('--depth'))).toBe(2);
  });
});

describe('FeatureTree · drift (WO-751, T4)', () => {
  const forest = [feature('MRD-001', 'Sin drift', [feature('FR-009', 'Con drift')])];

  it('el punto de drift no es el único portador: la fila lleva texto accesible', () => {
    renderTree(forest, { driftRefs: new Set(['FR-009']) });

    const row = screen.getByRole('treeitem', { name: /FR-009/ });
    expect(within(row).getByText('Drift abierto')).toBeTruthy();
    expect(row.textContent).toContain('Drift abierto');
    // El punto sigue siendo decorativo: quien lo ve de más no depende de él.
    const dot = row.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });

  it('una fila sin drift abierto no anuncia drift', () => {
    renderTree(forest, { driftRefs: new Set(['FR-009']) });

    expect(within(screen.getByRole('treeitem', { name: /MRD-001/ })).queryByText('Drift abierto')).toBeNull();
  });
});
