import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { LOCK_PATH, withRepoLock } from '../../src/util/lock.js';
import { makeTmpDir, removeDir } from '@prdm/testkit';

let root = '';
afterEach(() => root && removeDir(root));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withRepoLock', () => {
  test('serializes concurrent critical sections and releases the lock', async () => {
    root = makeTmpDir();
    const events: string[] = [];
    const section = (name: string) => async () => {
      events.push(`${name}:start`);
      await sleep(50);
      events.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([withRepoLock(root, section('a')), withRepoLock(root, section('b'))]);
    expect(results.sort()).toEqual(['a', 'b']);
    expect(events).toHaveLength(4);
    expect(events[1]?.endsWith(':end')).toBe(true);
    expect(events[0]?.split(':')[0]).toBe(events[1]?.split(':')[0]);
    expect(existsSync(join(root, LOCK_PATH))).toBe(false);
  });

  test('releases the lock when the section throws', async () => {
    root = makeTmpDir();
    await expect(withRepoLock(root, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(existsSync(join(root, LOCK_PATH))).toBe(false);
  });

  test('breaks a stale lock left by a dead process', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    writeFileSync(join(root, LOCK_PATH), JSON.stringify({ pid: 2_147_483_000, createdAt: new Date().toISOString() }));
    expect(await withRepoLock(root, async () => 'ok', { timeoutMs: 1000 })).toBe('ok');
  });

  test('times out while a live process holds the lock', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    writeFileSync(join(root, LOCK_PATH), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    await expect(withRepoLock(root, async () => 'never', { timeoutMs: 300 })).rejects.toThrow(/another prdm process/);
  });

  test('does not steal a live owner even with an old createdAt, as long as its heartbeat is recent', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      join(root, LOCK_PATH),
      JSON.stringify({ token: 'other', pid: process.pid, host: hostname(), createdAt: old, heartbeatAt: new Date().toISOString() }),
    );
    await expect(withRepoLock(root, async () => 'never', { timeoutMs: 300 })).rejects.toThrow(/another prdm process/);
    // the foreign lock must still be there: it was never broken
    expect(existsSync(join(root, LOCK_PATH))).toBe(true);
  });

  test('steals a lock whose owner pid is dead, regardless of its heartbeat freshness', async () => {
    root = makeTmpDir();
    mkdirSync(join(root, '.prdm'), { recursive: true });
    writeFileSync(
      join(root, LOCK_PATH),
      JSON.stringify({ token: 'other', pid: 2_147_483_000, host: hostname(), createdAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }),
    );
    expect(await withRepoLock(root, async () => 'ok', { timeoutMs: 1000 })).toBe('ok');
  });

  test('does not remove a lock whose token no longer matches ours on release', async () => {
    root = makeTmpDir();
    await withRepoLock(root, async () => {
      // Simulate another process breaking our (apparently stale) lock and acquiring its own while we still think we hold it.
      const foreign = { token: 'foreign-token', pid: process.pid, host: 'some-other-host', createdAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
      mkdirSync(join(root, '.prdm'), { recursive: true });
      writeFileSync(join(root, LOCK_PATH), JSON.stringify(foreign));
    });
    expect(JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8')).token).toBe('foreign-token');
  });

  test('refreshes the heartbeat on disk while the section runs', async () => {
    root = makeTmpDir();
    const seen: string[] = [];
    await withRepoLock(
      root,
      async () => {
        await sleep(20);
        seen.push(JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8')).heartbeatAt);
        await sleep(20);
        seen.push(JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8')).heartbeatAt);
        await sleep(20);
        seen.push(JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8')).heartbeatAt);
      },
      { heartbeatMs: 5 },
    );
    expect(new Set(seen).size).toBeGreaterThan(1);
  });
});
