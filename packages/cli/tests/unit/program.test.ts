import { beforeEach, describe, expect, test, vi } from 'vitest';

const connect = vi.fn();
const close = vi.fn(async () => undefined);
const loadConfig = vi.fn();

vi.mock('@prdm/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prdm/core')>();
  return {
    ...actual,
    loadConfig: (...args: unknown[]) => loadConfig(...args),
    Neo4jGraphStore: { connect: (...args: unknown[]) => connect(...args) },
  };
});

const { openContextFor } = await import('../../src/program.js');

beforeEach(() => {
  connect.mockReset();
  close.mockReset();
  loadConfig.mockReset();
});

describe('openContextFor', () => {
  test('falls back to loading real config, connecting to Neo4j, and building an Engine', async () => {
    const config = { root: '/repo', neo4j: { uri: 'neo4j://x', username: 'neo4j', password: 'p', database: 'neo4j' } };
    loadConfig.mockReturnValue(config);
    connect.mockReturnValue({ close });

    const open = openContextFor({ root: '/repo', stdout: () => {}, stderr: () => {} });
    const ctx = await open('/repo');

    expect(loadConfig).toHaveBeenCalledWith('/repo');
    expect(connect).toHaveBeenCalledWith(config.neo4j);
    expect(ctx.config).toBe(config);
    expect(ctx.engine).toBeDefined();

    await ctx.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test('uses the injected openContext when deps provide one', async () => {
    const injected = vi.fn(async () => ({ config: {}, store: {}, engine: {}, close: async () => {} }) as never);
    const open = openContextFor({ root: '/repo', stdout: () => {}, stderr: () => {}, openContext: injected });
    await open('/repo');
    expect(injected).toHaveBeenCalledWith('/repo');
    expect(loadConfig).not.toHaveBeenCalled();
  });
});
