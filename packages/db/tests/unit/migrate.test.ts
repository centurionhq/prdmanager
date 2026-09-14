import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/migrate.js';

describe('MIGRATIONS_FOLDER', () => {
  test('resolves next to this package, with a valid postgresql journal', () => {
    expect(existsSync(MIGRATIONS_FOLDER)).toBe(true);
    const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
    expect(existsSync(journalPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { dialect: string; entries: unknown[] };
    expect(journal.dialect).toBe('postgresql');
    // WO-092 lands the first real migration (better-auth tables + user_profile); entries grow from
    // later work orders, so this only pins the shape, not the count.
    expect(journal.entries.length).toBeGreaterThanOrEqual(1);
  });
});

describe('runMigrations', () => {
  test('accepts a Drizzle db and an optional migrations folder override', () => {
    expect(typeof runMigrations).toBe('function');
    expect(runMigrations.length).toBe(1);
  });
});
