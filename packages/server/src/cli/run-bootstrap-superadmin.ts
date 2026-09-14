#!/usr/bin/env node
/**
 * Real entrypoint for `bootstrapSuperadmin` (SDD-006 §Autenticación, WO-101): the only module in
 * `./bootstrap-superadmin.ts`'s family allowed to read `process.env`, `process.argv` or touch a real
 * terminal — mirrors `../main.ts`'s own role for the server itself. Never accepts the password via argv
 * or an environment variable; it is always read from a hidden, non-echoing stdin prompt.
 *
 * Connects with `DATABASE_MIGRATION_URL` (`prdm_owner`), never `DATABASE_URL` (`prdm_app`).
 */
import process from 'node:process';
import readline from 'node:readline';
import { createPool } from '@prdm/db';
import { bootstrapSuperadmin, SuperadminAlreadyExistsError, type BootstrapPrompts } from './bootstrap-superadmin.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function askVisible(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Reads a line from stdin without echoing it back — the only place this file (or anything it calls)
 * ever sees the raw password before handing it straight to `bootstrapSuperadmin`. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    const wasRaw = stdin.isTTY ? stdin.isRaw : undefined;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\n' || char === '\r' || char === '') {
          cleanup();
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '') {
          cleanup();
          reject(new Error('aborted'));
          return;
        }
        if (char === '' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      if (wasRaw !== undefined) stdin.setRawMode?.(wasRaw);
    };
    stdin.on('data', onData);
  });
}

function buildRealPrompts(): BootstrapPrompts {
  return {
    email: () => askVisible('Superadmin email: '),
    name: () => askVisible('Superadmin name: '),
    password: () => askHidden('Superadmin password (hidden): '),
    totpCode: () => askVisible('Enter the 6-digit code from your authenticator app: '),
  };
}

async function main(): Promise<void> {
  const additional = process.argv.includes('--additional');
  const migrationUrl = requireEnv('DATABASE_MIGRATION_URL');
  const publicUrl = requireEnv('PRDM_PUBLIC_URL');
  const betterAuthSecret = requireEnv('BETTER_AUTH_SECRET');

  const pool = createPool({ connectionString: migrationUrl });
  try {
    await bootstrapSuperadmin({
      pool,
      env: { publicUrl, betterAuthSecret },
      prompts: buildRealPrompts(),
      additional,
    });
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  if (err instanceof SuperadminAlreadyExistsError) {
    console.error(`[bootstrap-superadmin] ${err.message}`);
  } else {
    console.error('[bootstrap-superadmin] fatal error:', err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
});
