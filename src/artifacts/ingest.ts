import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { z } from 'zod';
import { ARTIFACT_SOURCES, docId } from '../domain/schema.js';
import type { Engine } from '../engine.js';
import { extractFeatureMentions, triageText } from '../feedback/triage.js';
import type { SearchHit } from '../graph/types.js';
import { nextId, renderDocument, slugify, todayIso } from '../util/ids.js';

export type ArtifactFormat = 'txt' | 'md' | 'eml' | 'vtt' | 'srt' | 'json';

export const MAX_ARTIFACT_BYTES = 1024 * 1024;

const EXTENSION_FORMATS: Readonly<Record<string, ArtifactFormat>> = {
  '.txt': 'txt',
  '.md': 'md',
  '.eml': 'eml',
  '.vtt': 'vtt',
  '.srt': 'srt',
  '.json': 'json',
};

const CUE_NUMBER = /^\d+$/;
const HEADER_KEYS = new Set(['subject', 'from', 'to', 'date']);

export function normalizeArtifactContent(raw: string, format: ArtifactFormat): string {
  const text = raw.replace(/\r\n?/g, '\n');
  if (format === 'vtt') return normalizeCues(text, true);
  if (format === 'srt') return normalizeCues(text, false);
  if (format === 'eml') return normalizeEmail(text);
  return text;
}

function normalizeCues(text: string, dropHeader: boolean): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let first = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (first) {
      first = false;
      if (dropHeader && /^WEBVTT/i.test(trimmed)) continue;
    }
    if (CUE_NUMBER.test(trimmed) || trimmed.includes('-->')) continue;
    kept.push(line);
  }
  return `${collapseBlankLines(kept).join('\n')}\n`;
}

function collapseBlankLines(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (line.trim() === '' && result[result.length - 1]?.trim() === '') continue;
    result.push(line);
  }
  while (result[0]?.trim() === '') result.shift();
  while (result[result.length - 1]?.trim() === '') result.pop();
  return result;
}

function normalizeEmail(text: string): string {
  const lines = text.split('\n');
  const blankIndex = lines.findIndex((line) => line.trim() === '');
  const headerLines = blankIndex === -1 ? lines : lines.slice(0, blankIndex);
  const bodyLines = blankIndex === -1 ? [] : lines.slice(blankIndex + 1);
  const kept = headerLines.filter((line) => HEADER_KEYS.has(line.split(':')[0]?.trim().toLowerCase() ?? ''));
  return `${kept.join('\n')}\n\n${bodyLines.join('\n').trim()}\n`;
}

const attachArtifactSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(1),
  source: z.enum(ARTIFACT_SOURCES).default('other'),
  links: z.array(docId).optional(),
  now: z.date().optional(),
});

export type AttachArtifactInput = z.input<typeof attachArtifactSchema>;

export interface AttachArtifactResult {
  id: string;
  path: string;
  linkedTo: string[];
  candidates: SearchHit[];
}

export async function attachArtifact(engine: Engine, input: AttachArtifactInput): Promise<AttachArtifactResult> {
  const parsed = attachArtifactSchema.parse(input);
  if (Buffer.byteLength(parsed.content, 'utf8') > MAX_ARTIFACT_BYTES) throw new Error(`content exceeds ${MAX_ARTIFACT_BYTES} bytes`);

  return engine.transaction(async (ops) => {
    const scan = await ops.scan();
    const featureIds = new Set(scan.docs.filter((d) => d.node.label === 'Feature').map((d) => d.node.id));
    for (const link of parsed.links ?? []) {
      if (!featureIds.has(link)) throw new Error(`link ${link} is not an existing Feature`);
    }

    const mentioned = extractFeatureMentions(parsed.content).filter((id) => featureIds.has(id));
    let links = [...new Set([...(parsed.links ?? []), ...mentioned])];
    let candidates: SearchHit[] = [];
    if (links.length === 0) {
      const triage = await triageText(ops.store, ops.config, parsed.content);
      candidates = triage.candidates;
      links = triage.autoLinkTo;
    }

    const id = nextId('ART', scan.ids);
    const slug = slugify(parsed.title);
    const fields = {
      id,
      type: 'ART',
      title: parsed.title,
      status: 'active',
      created_at: todayIso(parsed.now),
      source: parsed.source,
      provides_context_for: links,
    };
    const content = renderDocument(fields, `## Contenido\n\n${parsed.content}`);
    const doc = await ops.createDocument(`${ops.config.docsDir}/artifacts/${id}-${slug}.md`, content);
    await ops.refresh();

    return { id, path: doc.node.sourcePath, linkedTo: links, candidates };
  });
}

const ingestArtifactFileSchema = z.object({
  filePath: z.string().min(1),
  source: z.enum(ARTIFACT_SOURCES).default('other'),
  title: z.string().min(1).max(300).optional(),
  links: z.array(docId).optional(),
});

export type IngestArtifactFileInput = z.input<typeof ingestArtifactFileSchema>;

/** CLI-only helper: reads an arbitrary local file (not necessarily under the repo), normalizes it and attaches it. */
export async function ingestArtifactFile(engine: Engine, input: IngestArtifactFileInput): Promise<AttachArtifactResult> {
  const parsed = ingestArtifactFileSchema.parse(input);
  const ext = extname(parsed.filePath).toLowerCase();
  const format = EXTENSION_FORMATS[ext];
  if (!format) throw new Error(`unsupported artifact file extension: ${ext || '(none)'}`);

  const stats = await stat(parsed.filePath);
  if (stats.size > MAX_ARTIFACT_BYTES) throw new Error(`file exceeds ${MAX_ARTIFACT_BYTES} bytes`);

  const raw = await readFile(parsed.filePath, 'utf8');
  const content = normalizeArtifactContent(raw, format);
  const title = parsed.title ?? basename(parsed.filePath);
  return attachArtifact(engine, { title, content, source: parsed.source, links: parsed.links });
}
