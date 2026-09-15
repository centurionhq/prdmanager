/**
 * A minimal fixed-window rate counter for `/collab`'s update-rate limits (SDD-008 §"Servidor de tiempo
 * real": "≤ 30 updates por segundo por usuario ... y ≤ 100 por documento", WO-152). Injectable clock —
 * same reasoning as `../rate-limit/clock-store.js` — so tests never have to send real traffic for a
 * full wall-clock second to exercise the limit; production passes the real `() => new Date()` this
 * server already threads everywhere else.
 */
export interface RateWindowCounter {
  /** Increments the counter for `key`'s current window and returns whether it's still within `max`.
   * Once over, stays over for the rest of the window (never "catches up"). */
  tryConsume(key: string, max: number): boolean;
}

export function createRateWindowCounter(clock: () => Date, windowMs = 1000): RateWindowCounter {
  const windows = new Map<string, { windowStart: number; count: number }>();

  return {
    tryConsume(key, max) {
      const now = clock().getTime();
      let bucket = windows.get(key);
      if (!bucket || now - bucket.windowStart >= windowMs) {
        bucket = { windowStart: now, count: 0 };
        windows.set(key, bucket);
      }
      bucket.count += 1;
      return bucket.count <= max;
    },
  };
}
