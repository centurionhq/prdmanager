import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { MIGRATIONS_FOLDER, runMigrations } from '../../src/migrate.js';

describe('MIGRATIONS_FOLDER', () => {
  test('resolves next to this package, with an empty baseline journal', () => {
    expect(existsSync(MIGRATIONS_FOLDER)).toBe(true);
    const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
    expect(existsSync(journalPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { dialect: string; entries: unknown[] };
    expect(journal.dialect).toBe('postgresql');
    expect(journal.entries).toEqual([]);
  });
});

describe('runMigrations', () => {
  test('accepts a Drizzle db and an optional migrations folder override', () => {
    expect(typeof runMigrations).toBe('function');
    expect(runMigrations.length).toBe(1);
  });
});
