/** A CLI-level failure with an explicit process exit code; printed as a single line (no stack trace). */
export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
