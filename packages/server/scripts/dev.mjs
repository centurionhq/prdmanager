#!/usr/bin/env node
// SDD-006 "Local y despliegue": `npm run dev` at the repo root. A zero-dependency Node orchestrator (the
// SDD's own wording — no `concurrently` or similar) that runs the Fastify server under `tsx watch` and
// Vite for @prdm/app (which proxies /api, /collab and /mcp — see packages/app/vite.config.ts) as sibling
// child processes. Forwards SIGINT/SIGTERM to both, and exits non-zero the moment either one dies
// unexpectedly, so a broken dev environment never sits half-up unnoticed.
//
// `runDevProcesses` is exported so packages/server/tests/unit/dev-script.test.ts can exercise the
// orchestration logic against trivial stand-in commands, without spawning the real tsx/vite processes.
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This file lives at packages/server/scripts/dev.mjs — three levels below the repo root.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BIN_SUFFIX = process.platform === 'win32' ? '.cmd' : '';
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', `tsx${BIN_SUFFIX}`);
const NPM_BIN = `npm${BIN_SUFFIX}`;

/** @typedef {{ name: string; command: string; args: string[] }} ProcessSpec */

/** @type {ProcessSpec[]} */
export const DEV_PROCESSES = [
  {
    name: 'server',
    command: TSX_BIN,
    args: ['watch', '--conditions=@prdm/source', 'packages/server/src/main.ts'],
  },
  {
    name: 'app',
    command: NPM_BIN,
    args: ['run', 'dev', '--workspace=@prdm/app'],
  },
];

/** Sends `signal` to `child`'s whole process group (POSIX) so grandchildren spawned by tsx/vite stop too. */
export function terminate(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * Spawns every entry in `specs` as a detached sibling process, relays SIGINT/SIGTERM (or `signals` in
 * tests) to all of them, and resolves with the orchestrator's exit code once every child has exited:
 * `0` when the shutdown was requested via a relayed signal, non-zero the moment any child exits or
 * fails to start on its own (the other children are then stopped too).
 *
 * @param {ProcessSpec[]} specs
 * @param {{ cwd?: string; signals?: readonly NodeJS.Signals[]; onLog?: (name: string, message: string) => void }} [options]
 * @returns {Promise<number>}
 */
export async function runDevProcesses(specs, options = {}) {
  const cwd = options.cwd ?? REPO_ROOT;
  const signals = options.signals ?? ['SIGINT', 'SIGTERM'];
  const log = options.onLog ?? ((name, message) => process.stdout.write(`[dev:${name}] ${message}\n`));

  const children = specs.map((spec) => spawn(spec.command, spec.args, { cwd, stdio: 'inherit', detached: true }));

  let shuttingDown = false;
  let exitCode = 0;

  function stopAll(reason) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (reason) log('dev', reason);
    for (const child of children) terminate(child, 'SIGTERM');
  }

  const signalHandlers = signals.map((signal) => {
    const handler = () => stopAll(`received ${signal}, stopping server and app...`);
    process.on(signal, handler);
    return { signal, handler };
  });

  try {
    const exitPromises = children.map(
      (child, i) =>
        new Promise((resolve) => {
          child.on('error', (err) => {
            log(specs[i].name, `failed to start: ${err.message}`);
            if (!shuttingDown) {
              exitCode = 1;
              stopAll(`${specs[i].name} failed to start, stopping the other process too`);
            }
            resolve();
          });
          child.on('exit', (code, signal) => {
            if (!shuttingDown) {
              log(specs[i].name, signal ? `exited on signal ${signal}` : `exited unexpectedly with code ${code}`);
              exitCode = code && code !== 0 ? code : 1;
              stopAll(`${specs[i].name} died, stopping the other process too`);
            }
            resolve();
          });
        }),
    );

    await Promise.all(exitPromises);
    return exitCode;
  } finally {
    for (const { signal, handler } of signalHandlers) process.off(signal, handler);
  }
}

function isEntryPoint() {
  const entry = process.argv[1];
  return typeof entry === 'string' && import.meta.url === pathToFileURL(entry).href;
}

if (isEntryPoint()) {
  process.exitCode = await runDevProcesses(DEV_PROCESSES);
}
