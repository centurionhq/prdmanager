import type { ParsedDoc } from '../../src/domain/schema.js';
import { parseDocument } from '../../src/parser/frontmatter.js';

export function doc(frontmatter: string, body = 'body', path?: string): ParsedDoc {
  const content = `---\n${frontmatter.trim()}\n---\n${body}\n`;
  const idLine = /^id:\s*(\S+)/m.exec(frontmatter);
  const result = parseDocument(content, path ?? `docs/${idLine?.[1] ?? 'x'}.md`);
  if (!result?.ok) throw new Error(`fixture doc invalid: ${result ? result.error : 'no frontmatter'}`);
  return result.doc;
}

export const mrd = (): ParsedDoc => doc('id: MRD-001\ntype: MRD\ntitle: Market', 'market');
export const prd = (body = 'product'): ParsedDoc => doc('id: PRD-001\ntype: PRD\ntitle: Product\nimplements: [MRD-001]', body);
export const sdd = (body = 'design', governs = '["src/sync/**"]'): ParsedDoc =>
  doc(`id: SDD-001\ntype: SDD\ntitle: Design\narchitects: [PRD-001]\ngoverns: ${governs}`, body);
export const wo = (id: string, status: string, extra = ''): ParsedDoc =>
  doc(`id: ${id}\ntype: WO\ntitle: Task ${id}\nstatus: ${status}\nimplements: [SDD-001]\n${extra}`, 'task');
