/**
 * Injectable one-shot timeout scheduler for the `doc_updates` write batcher (SDD-008 §"Autoría por
 * línea no falsificable": "agrupados en una transacción por frame o por tick de hasta 50 ms") — same
 * injected-clock reasoning as `./scheduler.js`'s repeating interval, kept as a separate, narrower
 * interface (`scheduleTimeout`, not `scheduleInterval`) since a batch window fires at most once.
 */
export interface CollabBatchScheduler {
  /** Registers `callback` to run once, after `delayMs`; returns a disposer that cancels it if it
   * hasn't fired yet. */
  scheduleTimeout(callback: () => void, delayMs: number): () => void;
}

export const realCollabBatchScheduler: CollabBatchScheduler = {
  scheduleTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

export interface FakeCollabBatchScheduler extends CollabBatchScheduler {
  /** Fires every currently-pending timeout once, in registration order, awaiting nothing (callbacks
   * are synchronous) — simulates every open batch window closing at once, with no real time passing. */
  flushAll(): void;
}

export function createFakeCollabBatchScheduler(): FakeCollabBatchScheduler {
  const pending = new Set<() => void>();
  return {
    scheduleTimeout(callback) {
      const wrapped = () => {
        pending.delete(wrapped);
        callback();
      };
      pending.add(wrapped);
      return () => {
        pending.delete(wrapped);
      };
    },
    flushAll() {
      for (const callback of Array.from(pending)) callback();
    },
  };
}
