import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tabs, type TabDef } from '../../../src/components/Tabs/Tabs';

const TAB_DEFS: readonly TabDef[] = [
  { id: 'uno', label: 'Uno', panel: <p>Panel uno</p> },
  { id: 'dos', label: 'Dos', panel: <p>Panel dos</p> },
  { id: 'tres', label: 'Tres', panel: <p>Panel tres</p> },
];

function ControlledTabs({ initialId = 'uno' }: { readonly initialId?: string }) {
  const [activeId, setActiveId] = useState(initialId);
  return <Tabs ariaLabel="Ejemplo" idPrefix="ej" tabs={TAB_DEFS} activeId={activeId} onChange={setActiveId} />;
}

describe('Tabs', () => {
  it('renders a tablist with the given accessible name and one tab per entry', () => {
    render(<Tabs ariaLabel="Ejemplo" idPrefix="ej" tabs={TAB_DEFS} activeId="uno" onChange={vi.fn()} />);
    const tablist = screen.getByRole('tablist', { name: 'Ejemplo' });
    expect(within(tablist).getAllByRole('tab')).toHaveLength(3);
  });

  it('marks the active tab as selected and every other tab as not selected', () => {
    render(<Tabs ariaLabel="Ejemplo" idPrefix="ej" tabs={TAB_DEFS} activeId="dos" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Uno' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Dos' }).getAttribute('aria-selected')).toBe('true');
  });

  it('only the active tab is tab-reachable (roving tabindex)', () => {
    render(<Tabs ariaLabel="Ejemplo" idPrefix="ej" tabs={TAB_DEFS} activeId="dos" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Uno' }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tab', { name: 'Dos' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Tres' }).getAttribute('tabindex')).toBe('-1');
  });

  it('links each tab to its panel via aria-controls / aria-labelledby', () => {
    render(<Tabs ariaLabel="Ejemplo" idPrefix="ej" tabs={TAB_DEFS} activeId="uno" onChange={vi.fn()} />);
    const tab = screen.getByRole('tab', { name: 'Uno' });
    const panel = screen.getByRole('tabpanel', { name: 'Uno' });
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
  });

  it('renders only the active panel content, hiding the others', () => {
    const { container } = render(<Tabs ariaLabel="Ejemplo" idPrefix="ej" tabs={TAB_DEFS} activeId="uno" onChange={vi.fn()} />);
    expect(screen.getByText('Panel uno')).toBeTruthy();
    expect(screen.queryByText('Panel dos')).toBeNull();
    expect(container.querySelector('#ej-panel-dos')?.hasAttribute('hidden')).toBe(true);
  });

  it('calls onChange with the clicked tab id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs ariaLabel="Ejemplo" idPrefix="ej" tabs={TAB_DEFS} activeId="uno" onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: 'Dos' }));
    expect(onChange).toHaveBeenCalledWith('dos');
  });

  it('moves focus and selection to the next tab with ArrowRight, wrapping past the last one', async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initialId="tres" />);
    screen.getByRole('tab', { name: 'Tres' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Uno' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Uno' }));
  });

  it('moves focus and selection to the previous tab with ArrowLeft, wrapping before the first one', async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initialId="uno" />);
    screen.getByRole('tab', { name: 'Uno' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Tres' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Tres' }));
  });

  it('jumps to the first tab with Home and the last tab with End', async () => {
    const user = userEvent.setup();
    render(<ControlledTabs initialId="dos" />);
    screen.getByRole('tab', { name: 'Dos' }).focus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Uno' }).getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Tres' }).getAttribute('aria-selected')).toBe('true');
  });

  it('lets a caller override the tab, tablist and panel classNames', () => {
    render(
      <Tabs
        ariaLabel="Ejemplo"
        idPrefix="ej"
        tabs={TAB_DEFS}
        activeId="dos"
        onChange={vi.fn()}
        classNames={{
          wrapper: 'custom-wrapper',
          tablist: 'custom-tablist',
          tab: (selected) => (selected ? 'custom-tab-selected' : 'custom-tab'),
          panel: 'custom-panel',
        }}
      />,
    );
    expect(screen.getByRole('tablist').className).toBe('custom-tablist');
    expect(screen.getByRole('tab', { name: 'Uno' }).className).toBe('custom-tab');
    expect(screen.getByRole('tab', { name: 'Dos' }).className).toBe('custom-tab-selected');
    expect(screen.getByRole('tabpanel', { name: 'Dos' }).className).toBe('custom-panel');
  });
});
