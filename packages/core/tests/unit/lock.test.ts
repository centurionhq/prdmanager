import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
});
