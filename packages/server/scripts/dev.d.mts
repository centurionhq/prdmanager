// Hand-written declaration for dev.mjs (WO-122): TypeScript's `nodenext` resolution pairs a `.mjs`
// module with a sibling `.d.mts` for type information — `dev.mjs` itself stays plain, dependency-free
// JS with JSDoc comments, per SDD-006 "Local y despliegue".
import type { ChildProcess } from 'node:child_process';

export interface ProcessSpec {
  name: string;
  command: string;
  args: string[];
}

export const DEV_PROCESSES: ProcessSpec[];

export function terminate(child: ChildProcess, signal: NodeJS.Signals): void;

export interface RunDevProcessesOptions {
  cwd?: string;
  signals?: readonly NodeJS.Signals[];
  onLog?: (name: string, message: string) => void;
}

export function runDevProcesses(specs: ProcessSpec[], options?: RunDevProcessesOptions): Promise<number>;
