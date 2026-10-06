import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxItems } from '../../../src/features/entrada/useInboxItems';

describe('useInboxItems · feedback registered in the session (WO-674)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-06-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stamps it with the demo «ahora» (one screen, one clock), not with the real calendar', () => {
    const { result } = renderHook(() => useInboxItems());

    act(() => {
      result.current.registerFeedback({ title: 'Pedido nuevo', body: 'Detalle.', source: 'chat' });
    });

    expect(result.current.sinTriar[0]?.receivedAt).toBe('2026-09-15T10:00:00.000Z');
  });
});
