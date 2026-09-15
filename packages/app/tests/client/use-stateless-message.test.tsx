import { render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { useStatelessMessage } from '../../src/collab/use-stateless-message.js';

interface FakeProvider {
  on: (event: string, handler: (data: { payload: string }) => void) => void;
  off: (event: string, handler: (data: { payload: string }) => void) => void;
  emit: (payload: string) => void;
}

function makeFakeProvider(): FakeProvider {
  const handlers = new Set<(data: { payload: string }) => void>();
  return {
    on: (_event, handler) => handlers.add(handler),
    off: (_event, handler) => handlers.delete(handler),
    emit: (payload) => handlers.forEach((h) => h({ payload })),
  };
}

function Probe({ provider, type, onMessage }: { provider: FakeProvider; type: string; onMessage: () => void }) {
  useStatelessMessage(provider as never, type, onMessage);
  return null;
}

describe('useStatelessMessage', () => {
  test('calls onMessage only for a matching stateless message type', () => {
    const provider = makeFakeProvider();
    const onMessage = vi.fn();
    render(<Probe provider={provider} type="blame:stale" onMessage={onMessage} />);

    provider.emit(JSON.stringify({ type: 'validation:updated' }));
    expect(onMessage).not.toHaveBeenCalled();

    provider.emit(JSON.stringify({ type: 'blame:stale' }));
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  test('never throws on a malformed/non-JSON stateless payload', () => {
    const provider = makeFakeProvider();
    const onMessage = vi.fn();
    render(<Probe provider={provider} type="blame:stale" onMessage={onMessage} />);
    expect(() => provider.emit('not json at all')).not.toThrow();
    expect(onMessage).not.toHaveBeenCalled();
  });

  test('unsubscribes on unmount', () => {
    const provider = makeFakeProvider();
    const onMessage = vi.fn();
    const { unmount } = render(<Probe provider={provider} type="blame:stale" onMessage={onMessage} />);
    unmount();
    provider.emit(JSON.stringify({ type: 'blame:stale' }));
    expect(onMessage).not.toHaveBeenCalled();
  });
});
