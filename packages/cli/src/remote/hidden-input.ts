/**
 * Hidden, non-echoing stdin prompt (SDD-010 "CLI: credenciales y vinculación", WO-187: "token por
 * prompt oculto"). Mirrors `packages/server/src/cli/run-bootstrap-superadmin.ts`'s own `askHidden`
 * exactly (raw-mode stdin, manual backspace handling, restores the previous raw-mode state on exit) —
 * duplicated rather than imported since `packages/cli` has no dependency on `@prdm/server` (and
 * shouldn't gain one just for this), but kept byte-for-byte equivalent in behavior so there is exactly
 * one raw-mode-stdin pattern to reason about across the codebase.
 */
export function askHidden(question: string): Promise<string> {
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
