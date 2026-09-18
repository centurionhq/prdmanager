/**
 * `Tooltip` (SDD-027, WO-454): hover/focus explanation plate whose text stays reachable by assistive
 * tech at all times. jsdom applies no CSS module rules, so "visible" is asserted through the class the
 * component toggles and through `aria-describedby`/`role`, never through computed styles.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Tooltip } from '../../src/components/Tooltip/Tooltip';

function renderTooltip(tone?: 'light' | 'onDark') {
  render(
    <Tooltip text="El BC: por qué conviene hacerlo" tone={tone}>
      Caso de negocio
    </Tooltip>,
  );
  return {
    trigger: screen.getByText('Caso de negocio'),
    plate: screen.getByRole('tooltip'),
  };
}

describe('Tooltip', () => {
  it('links the trigger to its text via aria-describedby, so the explanation is never lost to a screen reader', () => {
    const { trigger, plate } = renderTooltip();
    expect(trigger.getAttribute('aria-describedby')).toBe(plate.getAttribute('id'));
    expect(plate.textContent).toBe('El BC: por qué conviene hacerlo');
  });

  it('keeps the text in the DOM while hidden, rather than unmounting it', () => {
    const { plate } = renderTooltip();
    expect(plate).toBeTruthy();
    expect(plate.className).not.toMatch(/plateVisible/);
  });

  it('shows the plate on hover and hides it again on mouse leave', async () => {
    const { trigger, plate } = renderTooltip();
    await userEvent.hover(trigger);
    expect(plate.className).toMatch(/plateVisible/);
    await userEvent.unhover(trigger);
    expect(plate.className).not.toMatch(/plateVisible/);
  });

  it('shows the plate on keyboard focus, not only on hover', async () => {
    const { trigger, plate } = renderTooltip();
    await userEvent.tab();
    expect(trigger).toBe(document.activeElement);
    expect(plate.className).toMatch(/plateVisible/);
  });

  it('dismisses the plate with Escape while the trigger keeps focus', async () => {
    const { trigger, plate } = renderTooltip();
    await userEvent.tab();
    expect(plate.className).toMatch(/plateVisible/);
    await userEvent.keyboard('{Escape}');
    expect(plate.className).not.toMatch(/plateVisible/);
    expect(trigger).toBe(document.activeElement);
  });

  it('tone="onDark" only changes the trigger, never the plate', () => {
    const { trigger, plate } = renderTooltip('onDark');
    expect(trigger.className).toMatch(/triggerOnDark/);
    expect(plate.className).not.toMatch(/OnDark/);
  });
});
