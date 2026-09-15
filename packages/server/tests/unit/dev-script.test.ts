import process from 'node:process';
import { describe, expect, test } from 'vitest';
import { runDevProcesses } from '../../scripts/dev.mjs';

// WO-122 / SDD-006 "Local y despliegue": `packages/server/scripts/dev.mjs` orchestrates the dev server
// and Vite as sibling processes without any new dependency (no `concurrently`). These tests exercise
// `runDevProcesses` against trivial `node -e` stand-ins instead of the real tsx/vite commands, and use a
// non-OS signal name (`SIGUSR2` isn't relayed by any shell here) so a failing assertion can never
// terminate the test runner itself.

const NODE = process.execPath;

function longRunning(name: string) {
  return { name, command: NODE, args: ['-e', 'setInterval(() => {}, 1000);'] };
}

function exitingAfter(name: string, code: number, delayMs = 50) {
  return { name, command: NODE, args: ['-e', `setTimeout(() => process.exit(${code}), ${delayMs});`] };
}

describe('runDevProcesses', () => {
  test('stops every child and resolves 0 once a relayed signal is received', async () => {
    const logs: string[] = [];
    const done = runDevProcesses([longRunning('one'), longRunning('two')], {
      signals: ['SIGUSR2'],
      onLog: (name, message) => logs.push(`${name}: ${message}`),
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    process.emit('SIGUSR2');

    await expect(done).resolves.toBe(0);
    expect(logs.some((line) => line.includes('received SIGUSR2'))).toBe(true);
  });

  test('stops the other child and resolves non-zero when one exits unexpectedly', async () => {
    const exitCode = await runDevProcesses([exitingAfter('flaky', 3), longRunning('steady')], { signals: ['SIGUSR2'] });
    expect(exitCode).toBe(3);
  });

  test('resolves 1 when a child exits with code 0 unexpectedly (not via a relayed signal)', async () => {
    const exitCode = await runDevProcesses([exitingAfter('quiet', 0), longRunning('steady')], { signals: ['SIGUSR2'] });
    expect(exitCode).toBe(1);
  });

  test('resolves 1 and stops the other child when a process fails to start', async () => {
    const logs: string[] = [];
    const exitCode = await runDevProcesses([{ name: 'missing', command: '/does/not/exist/prdm-binary', args: [] }, longRunning('steady')], {
      signals: ['SIGUSR2'],
      onLog: (name, message) => logs.push(`${name}: ${message}`),
    });

    expect(exitCode).toBe(1);
    expect(logs.some((line) => line.includes('missing: failed to start'))).toBe(true);
  });
});
