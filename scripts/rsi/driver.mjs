#!/usr/bin/env node
/**
 * WO-588 / SDD-057: the process a `systemd --user` unit runs forever (`scripts/rsi/systemd/
 * prdmanager-rsi.service.template`). Each iteration calls `runCycleOnce` (see `driver-lib.mjs` for the
 * guard/circuit-breaker/pacing logic) with a real `claude -p` invocation, then sleeps the returned delay
 * -- or stops issuing new cycles once paused, since `runCycleOnce` itself becomes a cheap no-op check
 * from then on (PRD-039 "Circuit breaker / kill switch": the sentinel/paused state is what a human clears
 * to resume, not something this driver clears on its own).
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from '../entry-point.mjs';
import { runCycleOnce } from './driver-lib.mjs';
import { enforceStartGuard } from './start-guard.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STATE_DIR = path.join(os.homedir(), '.local', 'state', 'prdmanager-rsi');
const STATE_PATH = path.join(STATE_DIR, 'loop-state.json');
const PAUSE_PATH = path.join(STATE_DIR, 'PAUSE');
const CYCLE_PROMPT_PATH = path.join(REPO_ROOT, 'scripts', 'rsi', 'cycle-prompt.md');
const SETTINGS_PATH = path.join(REPO_ROOT, '.claude', 'settings.rsi.json');

/** Runs one real `claude -p` cycle, feeding it `cycle-prompt.md` on stdin, and collects its stdout. */
async function runRealCycle() {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--settings', SETTINGS_PATH, '--output-format', 'json'], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout }));
    child.stdin.write(readCyclePrompt());
    child.stdin.end();
  });
}

function readCyclePrompt() {
  // Kept as a function (not a module-level constant) so a missing file fails loudly per-cycle instead
  // of crashing the whole driver process at startup.
  return readFileSync(CYCLE_PROMPT_PATH, 'utf8');
}

/** Aborta (exit 1) antes de cualquier ciclo si el checkout no es un punto de partida reproducible (SDD-063). */
export async function main(options = {}) {
  const { enforceGuard = () => enforceStartGuard({ cwd: REPO_ROOT }) } = options;
  const guard = enforceGuard();
  if (!guard.ok) return 1;
  for (;;) {
    const result = await runCycleOnce({ statePath: STATE_PATH, pausePath: PAUSE_PATH, runClaude: runRealCycle });
    if (!result.ran || result.state.pausedReason) {
      const reason = result.reason ?? result.state.pausedReason;
      console.error(`rsi-driver: paused (${reason}) -- clear ${PAUSE_PATH} or its pausedReason in ${STATE_PATH} to resume`);
      return 0;
    }
    console.log(`rsi-driver: cycle done, next in ${Math.round((result.delayMs ?? 0) / 60000)}min`);
    await new Promise((resolve) => setTimeout(resolve, result.delayMs ?? 0));
  }
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main();
}
