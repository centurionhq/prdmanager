import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createDebouncedRunner } from '../../src/cli/scheduler.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDebouncedRunner', () => {
  test('collapses a burst of schedule() calls into a single run after the debounce window', () => {
    const run = vi.fn();
    const runner = createDebouncedRunner(run, 100);

    runner.schedule();
    vi.advanceTimersByTime(50);
    runner.schedule();
    vi.advanceTimersByTime(50);
    runner.schedule();
    expect(run).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('runs again for a schedule() call after the previous run fired', () => {
    const run = vi.fn();
    const runner = createDebouncedRunner(run, 100);

    runner.schedule();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);

    runner.schedule();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('stop() cancels a pending run and ignores further schedule() calls', () => {
    const run = vi.fn();
    const runner = createDebouncedRunner(run, 100);

    runner.schedule();
    runner.stop();
    vi.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();

    runner.schedule();
    vi.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();
  });
});
