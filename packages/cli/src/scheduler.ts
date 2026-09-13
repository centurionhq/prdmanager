export interface DebouncedRunner {
  /** Requests a run; repeated calls within the debounce window collapse into a single run. */
  schedule(): void;
  /** Cancels any pending run and ignores future schedule() calls. */
  stop(): void;
}

type Timer = ReturnType<typeof setTimeout>;

/** Debounces `run` so a burst of schedule() calls (e.g. a chokidar batch) triggers it at most once per `waitMs`. */
export function createDebouncedRunner(run: () => void | Promise<void>, waitMs: number): DebouncedRunner {
  let timer: Timer | null = null;
  let stopped = false;

  return {
    schedule(): void {
      if (stopped) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, waitMs);
    },
    stop(): void {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
