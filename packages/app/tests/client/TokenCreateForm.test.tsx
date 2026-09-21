/**
 * WO-580 (SDD-056): the token creation form. The first test is a regression found in the real browser: the
 * expiry the form proposes by default was "today + 90 days, at the end of that day", which is up to a day past
 * the 90-day ceiling the server enforces, so *not touching the date* was refused with "expiresAt must be within
 * 90 days of now". The unit tests never noticed because they mock the API and never look at the date.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TOKEN_TTL_DAYS } from '@prdm/contracts';
import { TokenCreateForm } from '../../src/components/TokenCreateForm.js';

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

async function fillAndSubmit(onCreate: ReturnType<typeof vi.fn>): Promise<void> {
  render(<TokenCreateForm availableScopes={['reports:write']} onCreate={onCreate as never} />);
  await userEvent.type(screen.getByLabelText('Nombre'), 'ci');
  await userEvent.click(screen.getByLabelText('reports:write'));
  await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));
}

describe('TokenCreateForm expiry (WO-580, SDD-056)', () => {
  it.each([
    ['early in the day', '2026-09-21T01:00:00.000Z'],
    ['late in the day', '2026-09-21T23:30:00.000Z'],
    ['exactly at midnight', '2026-09-21T00:00:00.000Z'],
  ])('leaving the date as proposed never exceeds the ceiling the server enforces (%s)', async (_label, now) => {
    vi.setSystemTime(new Date(now));
    const onCreate = vi.fn().mockResolvedValue(undefined);

    await fillAndSubmit(onCreate);

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    const { expiresAt } = onCreate.mock.calls[0]?.[0] as { expiresAt: string };
    expect(new Date(expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + MAX_TOKEN_TTL_DAYS * DAY);
  });

  it('a shorter date is respected as chosen, to the end of that day', async () => {
    vi.setSystemTime(new Date('2026-09-21T10:00:00.000Z'));
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<TokenCreateForm availableScopes={['reports:write']} onCreate={onCreate as never} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'ci');
    await userEvent.click(screen.getByLabelText('reports:write'));
    const date = screen.getByLabelText('Vence');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect((onCreate.mock.calls[0]?.[0] as { expiresAt: string }).expiresAt).toBe('2026-10-01T23:59:59.999Z');
  });
});

describe('TokenCreateForm (WO-580, SDD-056)', () => {
  it('can be cancelled without creating anything', async () => {
    const onCreate = vi.fn();
    const onCancel = vi.fn();
    render(<TokenCreateForm availableScopes={['reports:write']} onCreate={onCreate as never} onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('without a way to cancel it draws no Cancelar button', () => {
    render(<TokenCreateForm availableScopes={['reports:write']} onCreate={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('asks for a name and a scope before it sends anything, and says which', async () => {
    const onCreate = vi.fn();
    render(<TokenCreateForm availableScopes={['reports:write']} onCreate={onCreate as never} />);

    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    expect(screen.getByText('Ingresá un nombre.')).toBeTruthy();
    expect(screen.getByText('Elegí al menos un scope.')).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('shows what the server refused, and keeps what was typed', async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error('boom'));
    render(<TokenCreateForm availableScopes={['reports:write']} onCreate={onCreate as never} />);
    await userEvent.type(screen.getByLabelText('Nombre'), 'ci');
    await userEvent.click(screen.getByLabelText('reports:write'));

    await userEvent.click(screen.getByRole('button', { name: 'Crear token' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('ci');
  });
});
