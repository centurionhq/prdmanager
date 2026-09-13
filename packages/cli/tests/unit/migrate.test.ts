import { Command } from 'commander';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CliContext, CliDeps } from '../../src/program.js';

const migrateDocs = vi.fn();

vi.mock('@prdm/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prdm/core')>();
  return { ...actual, migrateDocs: (...args: unknown[]) => migrateDocs(...args) };
});

const { register } = await import('../../src/commands/migrate.js');

function buildProgram(deps: CliDeps): Command {
  const program = new Command().exitOverride();
  register(program, deps);
  return program;
}

function fakeDeps(overrides: Partial<CliDeps> = {}): { deps: CliDeps; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ctx: CliContext = {
    config: {} as never,
    db: { assertSchemaCurrent: async () => {} } as never,
    store: {} as never,
    engine: { recover: async () => {} } as never,
    close: async () => {},
  };
  return {
    stdout,
    stderr,
    deps: { root: '/repo', stdout: (l) => stdout.push(l), stderr: (l) => stderr.push(l), openContext: async () => ctx, ...overrides },
  };
}

beforeEach(() => {
  migrateDocs.mockReset();
});

describe('migrate docs command', () => {
  test('prints a human-readable summary by default', async () => {
    migrateDocs.mockResolvedValue({
      dryRun: false,
      fieldChanges: [{ id: 'SDD-001', path: 'docs/blueprints/SDD-001.md', changes: ['governs -> impacts_paths'] }],
      rebaselinedBlueprints: ['SDD-001'],
      rebaselinedWorkOrders: ['WO-001'],
      report: { documents: 3, errors: [], issues: [], workOrderUpdates: [], baselineWritten: true, hasBlockingIssues: false },
    });
    const { deps, stdout } = fakeDeps();

    const program = buildProgram(deps);
    await program.parseAsync(['node', 'prdm', 'migrate', 'docs']);

    expect(migrateDocs).toHaveBeenCalledWith(expect.anything(), { dryRun: undefined });
    const text = stdout.join('\n');
    expect(text).toContain('dryRun: false');
    expect(text).toContain('SDD-001  docs/blueprints/SDD-001.md  governs -> impacts_paths');
    expect(text).toContain('rebaselined blueprints: SDD-001');
    expect(text).toContain('rebaselined work orders: WO-001');
    expect(text).toContain('documents: 3');
  });

  test('prints "(none)" when nothing changed and passes --dry-run through', async () => {
    migrateDocs.mockResolvedValue({ dryRun: true, fieldChanges: [], rebaselinedBlueprints: [], rebaselinedWorkOrders: [] });
    const { deps, stdout } = fakeDeps();

    const program = buildProgram(deps);
    await program.parseAsync(['node', 'prdm', 'migrate', 'docs', '--dry-run']);

    expect(migrateDocs).toHaveBeenCalledWith(expect.anything(), { dryRun: true });
    const text = stdout.join('\n');
    expect(text).toContain('dryRun: true');
    expect(text).toContain('field changes: (none)');
    expect(text).toContain('rebaselined blueprints: (none)');
    expect(text).not.toContain('documents:');
  });

  test('prints the result as JSON with --json', async () => {
    const result = { dryRun: true, fieldChanges: [], rebaselinedBlueprints: [], rebaselinedWorkOrders: [] };
    migrateDocs.mockResolvedValue(result);
    const { deps, stdout } = fakeDeps();

    const program = buildProgram(deps);
    await program.parseAsync(['node', 'prdm', 'migrate', 'docs', '--json']);

    expect(JSON.parse(stdout.join('\n'))).toEqual(result);
  });
});
