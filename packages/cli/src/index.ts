#!/usr/bin/env node
import { discoverProjectRoot } from '@prdm/core';
import { runCli } from './program.js';

const root = discoverProjectRoot(process.cwd(), process.env);
const deps = {
  root,
  stdout: (line: string) => process.stdout.write(`${line}\n`),
  stderr: (line: string) => process.stderr.write(`${line}\n`),
};

try {
  process.exitCode = await runCli(process.argv, deps);
} catch (err) {
  deps.stderr(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
