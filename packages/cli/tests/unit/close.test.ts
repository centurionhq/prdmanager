import { Command } from 'commander';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CliContext, CliDeps } from '../../src/program.js';

const closeFeature = vi.fn();
const closureReadiness = vi.fn();

vi.mock('@prdm/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prdm/core')>();
  return {
    ...actual,
    closeFeature: (...args: unknown[]) => closeFeature(...args),
    closureReadiness: (...args: unknown[]) => closureReadiness(...args),
  };
});

const { register } = await import('../../src/commands/close.js');

function buildProgram(deps: CliDeps): Command {
  const program = new Command().exitOverride();
  register(program, deps);
  return program;
}

function fakeDeps(overrides: Partial<CliDeps> = {}): { deps: CliDeps; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ctx: CliContext = { config: {} as never, db: { assertSchemaCurrent: async () => {} } as never, store: {} as never, engine: {} as never, close: async () => {} };
  return {
    stdout,
    stderr,
    deps: { root: '/repo', stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l), openContext: async () => ctx, ...overrides },
  };
}

beforeEach(() => {
  closeFeature.mockReset();
  closureReadiness.mockReset();
  delete process.env.PRDM_ACTOR;
});

describe('close command (WO-019, ADR-002 D14 human gate)', () => {
  test('refuses to close without --ack, explaining the architect gate, and never calls closeFeature', async () => {
    const { deps, stderr } = fakeDeps();
    const program = buildProgram(deps);

    const code = await program.parseAsync(['node', 'prdm', 'close', 'PRD-001', '--by', 'dev:x']).then(
      () => 0,
      (err: { exitCode?: number }) => err.exitCode ?? 1,
    );

    expect(code).not.toBe(0);
    expect(closeFeature).not.toHaveBeenCalled();
  });

  test('requires an actor via --by or $PRDM_ACTOR', async () => {
    const { deps } = fakeDeps();
    const program = buildProgram(deps);

    await expect(program.parseAsync(['node', 'prdm', 'close', 'PRD-001', '--ack'])).rejects.toThrow();
    expect(closeFeature).not.toHaveBeenCalled();
  });

  test('closes and prints a summary once --ack and an actor are given', async () => {
    closeFeature.mockResolvedValue({ featureId: 'PRD-001', closedAt: '2026-09-13T00:00:00.000Z', closedBy: 'dev:x', report: { hasBlockingIssues: false } });
    const { deps, stdout } = fakeDeps();
    const program = buildProgram(deps);

    await program.parseAsync(['node', 'prdm', 'close', 'PRD-001', '--ack', '--by', 'dev:x']);

    expect(closeFeature).toHaveBeenCalledWith(expect.anything(), 'PRD-001', { by: 'dev:x' });
    expect(stdout.join('\n')).toContain('PRD-001: closed at 2026-09-13T00:00:00.000Z by dev:x');
  });

  test('prints the close result as JSON with --json', async () => {
    const result = { featureId: 'PRD-001', closedAt: '2026-09-13T00:00:00.000Z', closedBy: 'dev:x', report: { hasBlockingIssues: false } };
    closeFeature.mockResolvedValue(result);
    const { deps, stdout } = fakeDeps();
    const program = buildProgram(deps);

    await program.parseAsync(['node', 'prdm', 'close', 'PRD-001', '--ack', '--by', 'dev:x', '--json']);

    expect(JSON.parse(stdout.join('\n'))).toEqual(result);
  });

  test('falls back to $PRDM_ACTOR when --by is omitted', async () => {
    process.env.PRDM_ACTOR = 'agent:claude';
    closeFeature.mockResolvedValue({ featureId: 'PRD-001', closedAt: 'x', closedBy: 'agent:claude', report: { hasBlockingIssues: false } });
    const { deps } = fakeDeps();
    const program = buildProgram(deps);

    await program.parseAsync(['node', 'prdm', 'close', 'PRD-001', '--ack']);

    expect(closeFeature).toHaveBeenCalledWith(expect.anything(), 'PRD-001', { by: 'agent:claude' });
  });

  test('closure-readiness prints per-check status', async () => {
    closureReadiness.mockResolvedValue({
      featureId: 'PRD-001',
      ready: false,
      checks: [{ name: 'work_orders_done', ok: false, detail: 'pending work order(s): WO-002' }],
    });
    const { deps, stdout } = fakeDeps();
    const program = buildProgram(deps);

    await program.parseAsync(['node', 'prdm', 'closure-readiness', 'PRD-001']);

    const text = stdout.join('\n');
    expect(text).toContain('not ready');
    expect(text).toContain('work_orders_done');
  });
});
