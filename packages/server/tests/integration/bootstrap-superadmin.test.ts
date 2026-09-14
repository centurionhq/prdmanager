/**
 * WO-101/WO-102 — `bootstrapSuperadmin`: hidden-prompt path (via an injected `BootstrapPrompts`), the
 * "already exists unless --additional" guard, mandatory TOTP enrollment before the command completes,
 * and the `platform_audit_log` entry it leaves. Runs against the real test Postgres instance through
 * `pg.ownerPool` (`prdm_owner` — exactly what this command is documented to require, never `prdm_app`).
 */
import { countPlatformAdmins, isPlatformAdmin, readPlatformAuditLog } from '@prdm/db';
import { openTestPg, truncateAll, type PgTestDb } from '@prdm/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { bootstrapSuperadmin, SuperadminAlreadyExistsError, type BootstrapPrompts } from '../../src/cli/bootstrap-superadmin.js';
import { buildTestServerEnv } from '../helpers/test-env.js';
import { computeTotpCode } from '../helpers/totp.js';

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

/** Captures the TOTP enrollment URI `bootstrapSuperadmin` prints via `log` (WO-102: shown once, never
 * to a file) and answers `prompts.totpCode()` with a code computed from it — standing in for an
 * operator reading the URI/QR and typing back what their authenticator app shows. */
function buildFixture(overrides: Partial<Record<'email' | 'name' | 'password', string>> = {}): {
  prompts: BootstrapPrompts;
  log: (message: string) => void;
  loggedLines: string[];
} {
  let totpUri: string | undefined;
  const loggedLines: string[] = [];
  const prompts: BootstrapPrompts = {
    email: async () => overrides.email ?? 'superadmin@example.test',
    name: async () => overrides.name ?? 'Root Superadmin',
    password: async () => overrides.password ?? 'correct-horse-battery-staple',
    totpCode: async () => {
      if (!totpUri) throw new Error('no TOTP URI captured from log() yet');
      return computeTotpCode(totpUri);
    },
  };
  const log = (message: string): void => {
    loggedLines.push(message);
    const match = /otpauth:\/\/\S+/.exec(message);
    if (match) totpUri = match[0];
  };
  return { prompts, log, loggedLines };
}

describe('bootstrapSuperadmin (WO-101/WO-102)', () => {
  test('creates the user, enrolls TOTP, the platform_admins row and a platform_audit_log entry via injected hidden prompts', async () => {
    const { prompts, log } = buildFixture({ email: 'root@example.test' });
    const passwordSpy = vi.fn(prompts.password);

    const result = await bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts: { ...prompts, password: passwordSpy }, log });

    expect(result.email).toBe('root@example.test');
    expect(await isPlatformAdmin(pg.ownerPool, result.userId)).toBe(true);
    expect(passwordSpy).toHaveBeenCalledTimes(1);

    const { rows } = await pg.ownerPool.query<{ twoFactorEnabled: boolean }>(`SELECT "twoFactorEnabled" FROM "user" WHERE id = $1`, [result.userId]);
    expect(rows[0]!.twoFactorEnabled).toBe(true);

    const entries = await readPlatformAuditLog(pg.ownerPool, result.userId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'platform.superadmin.bootstrapped', actorId: result.userId });
    // The password itself never appears in the audit trail.
    expect(JSON.stringify(entries[0]!.metadata)).not.toContain('correct-horse-battery-staple');
  });

  test('the enrollment URI is printed to the terminal exactly once, via the injected log function', async () => {
    const { prompts, log, loggedLines } = buildFixture();
    await bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts, log });

    const withUri = loggedLines.filter((line) => line.includes('otpauth://'));
    expect(withUri).toHaveLength(1);
  });

  test('refuses a second superadmin unless --additional (here: options.additional)', async () => {
    const first = buildFixture({ email: 'first@example.test' });
    await bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts: first.prompts, log: first.log });

    const second = buildFixture({ email: 'second@example.test' });
    await expect(bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts: second.prompts, log: second.log })).rejects.toBeInstanceOf(
      SuperadminAlreadyExistsError,
    );
    expect(await countPlatformAdmins(pg.ownerPool)).toBe(1);

    const third = buildFixture({ email: 'second@example.test' });
    const created = await bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts: third.prompts, log: third.log, additional: true });
    expect(await countPlatformAdmins(pg.ownerPool)).toBe(2);
    expect(created.email).toBe('second@example.test');
  });

  test('the injected log function never receives the raw password', async () => {
    const { prompts, log, loggedLines } = buildFixture({ password: 'super-secret-password-1' });
    await bootstrapSuperadmin({ pool: pg.ownerPool, env, prompts, log });
    expect(loggedLines.join('\n')).not.toContain('super-secret-password-1');
  });
});
