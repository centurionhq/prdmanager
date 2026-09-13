import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const BASELINE_PATH = '.prdm/baseline.json';

const baselineSchema = z.object({
  version: z.literal(1),
  docs: z.record(z.string(), z.string()),
  governs: z.record(z.string(), z.record(z.string(), z.string().nullable())),
});

export type Baseline = z.infer<typeof baselineSchema>;

export function emptyBaseline(): Baseline {
  return { version: 1, docs: {}, governs: {} };
}

export async function loadBaseline(root: string): Promise<Baseline> {
  let raw: string;
  try {
    raw = await readFile(join(root, BASELINE_PATH), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyBaseline();
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${BASELINE_PATH} is not valid JSON; restore it from git or delete it to re-baseline`);
  }
  const parsed = baselineSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${BASELINE_PATH} has an invalid baseline format; restore it from git or delete it to re-baseline`);
  return parsed.data;
}

export function serializeBaseline(baseline: Baseline): string {
  const sortKeys = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  const governs = Object.fromEntries(Object.entries(sortKeys(baseline.governs)).map(([bp, refs]) => [bp, sortKeys(refs)]));
  return `${JSON.stringify({ version: 1, docs: sortKeys(baseline.docs), governs }, null, 2)}\n`;
}

/** Writes the baseline only when its serialized content changed, to avoid noisy diffs. */
export async function saveBaseline(root: string, baseline: Baseline): Promise<boolean> {
  const path = join(root, BASELINE_PATH);
  const next = serializeBaseline(baseline);
  const current = await readFile(path, 'utf8').catch(() => null);
  if (current === next) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next);
  return true;
}
