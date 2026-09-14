/**
 * WO-101 — `bootstrapSuperadmin`: hidden-prompt path (via an injected `BootstrapPrompts`), the
 * "already exists unless --additional" guard, and the `platform_audit_log` entry it leaves. Runs
 * against the real test Postgres instance through `pg.ownerPool` (`prdm_owner` — exactly what this
 * command is documented to require, never `prdm_app`).
 */
import { countPlatformAdmins, isPlatformAdmin, readPlatformAuditLog } from '@prdm/db';
import { openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { bootstrapSuperadmin, SuperadminAlreadyExistsError, type BootstrapPrompts } from '../../src/cli/bootstrap-superadmin.js';
import { buildTestServerEnv } from '../helpers/test-env.js';

let pg: PgTestDb;
const env = buildTestServerEnv();

beforeAll(async () => {
  pg = await openTestPg();
});

afterEach(async () => {
  await truncateAll(pg.ownerPool);
});

afterAll(async () => {
  await pg.close();
});

function fixedPrompts(overrides: Partial<Record<keyof BootstrapPrompts, string>> = {}): BootstrapPrompts {
  return {
    email: async () => overrides.email ?? 'superadmin@example.test',
    name: async () => overrides.name ?? 'Root Superadmin',
    password: async () => overrides.password ?? 'correct-horse-battery-staple',
  };
}

describe('bootstrapSuperadmin (WO-101)', () => {
  test('creates the user, the platform_admins row and a platform_audit_log entry via injected hidden prompts', async () => {
    const prompts = fixedPrompts({ email: 'root@example.test' });
    const passwordSpy = vi.fn(prompts.password);

    const result = await bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts: { ...prompts, password: passwordSpy }, log: () => {} });

    expect(result.email).toBe('root@example.test');
    expect(await isPlatformAdmin(pg.ownerPool, result.userId)).toBe(true);
    expect(passwordSpy).toHaveBeenCalledTimes(1);

    const entries = await readPlatformAuditLog(pg.ownerPool, result.userId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'platform.superadmin.bootstrapped', actorId: result.userId });
    // The password itself never appears in the audit trail.
    expect(JSON.stringify(entries[0]!.metadata)).not.toContain('correct-horse-battery-staple');
  });

  test('refuses a second superadmin unless --additional (here: options.additional)', async () => {
    await bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts: fixedPrompts({ email: 'first@example.test' }), log: () => {} });

    await expect(
      bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts: fixedPrompts({ email: 'second@example.test' }), log: () => {} }),
    ).rejects.toBeInstanceOf(SuperadminAlreadyExistsError);
    expect(await countPlatformAdmins(pg.ownerPool)).toBe(1);

    const second = await bootstrapSuperadmin({
      pool: pg.ownerPool,
      env,
      prompts: fixedPrompts({ email: 'second@example.test' }),
      additional: true,
      log: () => {},
    });
    expect(await countPlatformAdmins(pg.ownerPool)).toBe(2);
    expect(second.email).toBe('second@example.test');
  });

  test('the injected log function never receives the raw password', async () => {
    const logged: string[] = [];
    await bootstrapSuperadmin({
      pool: pg.ownerPool,
      env,
      prompts: fixedPrompts({ password: 'super-secret-password-1' }),
      log: (message) => logged.push(message),
    });
    expect(logged.join('\n')).not.toContain('super-secret-password-1');
  });
});
