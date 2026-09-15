/**
 * Injectable scheduler for `/collab`'s periodic per-connection revalidation (SDD-008 §"Servidor de
 * tiempo real": "cada conexión revalida sesión y rol cada 60 segundos") — same reasoning as
 * `../rate-limit/clock-store.js`'s injectable clock: production never overrides this (a real
 * `setInterval`), while tests inject a fake one so a 60-second interval never means a real 60-second
 * `sleep` (this repo's own hard-won lesson about wall-clock-timed tests, see `packages/core/tests/unit/
 * lock*.ts`'s git history).
 */
export interface CollabScheduler {
  /** Registers `callback` to run every `intervalMs`; returns a disposer that stops it. Mirrors the
   * real `setInterval`/`clearInterval` pair's shape exactly, so the real implementation is a one-liner. */
  scheduleInterval(callback: () => void | Promise<void>, intervalMs: number): () => void;
}

export const realCollabScheduler: CollabScheduler = {
  scheduleInterval(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs);
    return () => clearInterval(handle);
  },
};

export interface FakeCollabScheduler extends CollabScheduler {
  /** Runs every currently-registered callback once, sequentially, awaiting each — simulates one
   * "tick" of every connection's revalidation interval firing, with no real time passing. */
  triggerAll(): Promise<void>;
  /** Number of currently-registered (not yet disposed) interval callbacks — lets a test assert a
   * connection's interval was actually cleaned up on close. */
  readonly size: number;
  /** Resolves the next time any interval this scheduler registered is disposed (a connection's
   * `onClose` cleanup running) — event-driven so a test can confirm cleanup happened without polling
   * `size` on a timer. */
  waitForNextDisposal(): Promise<void>;
}

/** A manually-advanced scheduler for tests (SDD-008's own "no wall-clock assertions" requirement): no
 * real timer is ever created. */
export function createFakeCollabScheduler(): FakeCollabScheduler {
  const callbacks = new Set<() => void | Promise<void>>();
  let nextDisposalWaiters: Array<() => void> = [];

  return {
    scheduleInterval(callback) {
      callbacks.add(callback);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        callbacks.delete(callback);
        const waiters = nextDisposalWaiters;
        nextDisposalWaiters = [];
        waiters.forEach((resolve) => resolve());
      };
    },
    async triggerAll() {
      for (const callback of Array.from(callbacks)) {
        await callback();
      }
    },
    get size() {
      return callbacks.size;
    },
    waitForNextDisposal() {
      return new Promise((resolve) => nextDisposalWaiters.push(resolve));
    },
  };
}
