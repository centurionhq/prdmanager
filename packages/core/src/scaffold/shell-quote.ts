/** POSIX single-quote escaping: safe for any byte sequence, including embedded quotes and spaces. */
export function shellQuoteSingle(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}
