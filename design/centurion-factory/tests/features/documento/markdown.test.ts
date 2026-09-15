import { describe, expect, it } from 'vitest';
import type { DocumentBlock } from '../../../src/data';
import {
  htmlToInline,
  inlineToHtml,
  parseLine,
  parseMarkdown,
  reconcileBlocks,
  sanitizeHref,
  serializeBlocks,
} from '../../../src/features/documento/markdown';

function block(id: string, type: DocumentBlock['type'], text: string, extra?: Partial<DocumentBlock>): DocumentBlock {
  return { id, type, text, author: 'ana-rios', ...extra };
}

describe('serializeBlocks', () => {
  it('prefixes each block type with its Markdown marker', () => {
    const blocks: DocumentBlock[] = [
      block('b1', 'h1', 'Título'),
      block('b2', 'h2', 'Sección'),
      block('b3', 'h3', 'Subsección'),
      block('b4', 'li', 'Un punto'),
      block('b5', 'task', 'Tarea pendiente', { checked: false }),
      block('b6', 'task', 'Tarea hecha', { checked: true }),
    ];
    const lines = serializeBlocks(blocks).split('\n');
    expect(lines).toContain('# Título');
    expect(lines).toContain('## Sección');
    expect(lines).toContain('### Subsección');
    expect(lines).toContain('- Un punto');
    expect(lines).toContain('- [ ] Tarea pendiente');
    expect(lines).toContain('- [x] Tarea hecha');
  });

  it('numbers consecutive ordered-list blocks starting at 1', () => {
    const blocks: DocumentBlock[] = [block('b1', 'ol', 'Primero'), block('b2', 'ol', 'Segundo'), block('b3', 'ol', 'Tercero')];
    expect(serializeBlocks(blocks)).toBe('1. Primero\n2. Segundo\n3. Tercero');
  });

  it('restarts ordered-list numbering after a non-ol block', () => {
    const blocks: DocumentBlock[] = [block('b1', 'ol', 'Uno'), block('b2', 'li', 'Interrupción'), block('b3', 'ol', 'Reinicia en 1')];
    const lines = serializeBlocks(blocks).split('\n');
    expect(lines).toContain('1. Uno');
    expect(lines).toContain('1. Reinicia en 1');
  });

  it('inserts a blank line before the next heading, but not between a heading and its list', () => {
    const blocks: DocumentBlock[] = [block('b1', 'h2', 'Tareas'), block('b2', 'task', 'Uno'), block('b3', 'task', 'Dos'), block('b4', 'h2', 'Riesgos')];
    expect(serializeBlocks(blocks)).toBe('## Tareas\n- [ ] Uno\n- [ ] Dos\n\n## Riesgos');
  });
});

describe('parseLine', () => {
  it('recognizes every block marker', () => {
    expect(parseLine('# Título')).toEqual({ type: 'h1', text: 'Título' });
    expect(parseLine('## Título')).toEqual({ type: 'h2', text: 'Título' });
    expect(parseLine('### Título')).toEqual({ type: 'h3', text: 'Título' });
    expect(parseLine('- Un punto')).toEqual({ type: 'li', text: 'Un punto' });
    expect(parseLine('1. Primero')).toEqual({ type: 'ol', text: 'Primero' });
    expect(parseLine('- [ ] Pendiente')).toEqual({ type: 'task', text: 'Pendiente', checked: false });
    expect(parseLine('- [x] Hecho')).toEqual({ type: 'task', text: 'Hecho', checked: true });
    expect(parseLine('Texto normal')).toEqual({ type: 'p', text: 'Texto normal' });
  });

  it('returns null for a blank line', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
  });
});

describe('parseMarkdown', () => {
  it('skips blank separator lines', () => {
    const parsed = parseMarkdown('# Título\n\nUn párrafo.\n\n- Un punto');
    expect(parsed).toEqual([
      { type: 'h1', text: 'Título' },
      { type: 'p', text: 'Un párrafo.' },
      { type: 'li', text: 'Un punto' },
    ]);
  });
});

describe('round-trip: serializeBlocks -> parseMarkdown', () => {
  it('recovers the same sequence of type/text/checked for a realistic document', () => {
    const blocks: DocumentBlock[] = [
      block('b1', 'h1', 'Frontend de diseño de Centurion Factory'),
      block('b2', 'h2', 'Contexto'),
      block('b3', 'p', 'El paquete design/centurion-factory aísla el rediseño de packages/app.'),
      block('b4', 'h2', 'Decisiones'),
      block('b5', 'li', 'Archivo para todo el texto.'),
      block('b6', 'li', 'Tokens en tokens.css.'),
      block('b7', 'h2', 'Tareas'),
      block('b8', 'task', 'WO-267 tokens.css', { checked: false }),
      block('b9', 'task', 'WO-275 Router y AppShell', { checked: true }),
      block('b10', 'ol', 'Paso uno'),
      block('b11', 'ol', 'Paso dos'),
    ];

    const roundTripped = parseMarkdown(serializeBlocks(blocks)).map((line) => ({ type: line.type, text: line.text, checked: line.checked }));
    const original = blocks.map((b) => ({ type: b.type, text: b.text, checked: b.checked }));
    expect(roundTripped).toEqual(original);
  });

  it('round-trips single-block documents of every type', () => {
    for (const b of [
      block('b1', 'h1', 'Uno'),
      block('b1', 'h2', 'Uno'),
      block('b1', 'h3', 'Uno'),
      block('b1', 'p', 'Uno'),
      block('b1', 'li', 'Uno'),
      block('b1', 'task', 'Uno', { checked: false }),
      block('b1', 'task', 'Uno', { checked: true }),
    ]) {
      const [parsed] = parseMarkdown(serializeBlocks([b]));
      expect(parsed).toEqual({ type: b.type, text: b.text, checked: b.checked });
    }
  });
});

describe('inlineToHtml', () => {
  it('renders bold, italic, strikethrough and links as real markup', () => {
    expect(inlineToHtml('**negrita**')).toBe('<strong>negrita</strong>');
    expect(inlineToHtml('_cursiva_')).toBe('<em>cursiva</em>');
    expect(inlineToHtml('~~tachado~~')).toBe('<del>tachado</del>');
    expect(inlineToHtml('[prdmanager](https://example.com)')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">prdmanager</a>',
    );
  });

  it('nests bold and italic', () => {
    expect(inlineToHtml('**negrita _e itálica_**')).toBe('<strong>negrita <em>e itálica</em></strong>');
  });

  it('escapes < and & so raw markup never leaks into the DOM', () => {
    expect(inlineToHtml('A < B & C')).toBe('A &lt; B &amp; C');
    expect(inlineToHtml('**A < B & C**')).toBe('<strong>A &lt; B &amp; C</strong>');
  });

  it('leaves plain text untouched', () => {
    expect(inlineToHtml('Texto normal sin formato.')).toBe('Texto normal sin formato.');
  });
});

describe('sanitizeHref', () => {
  it('keeps http, https, mailto and relative/fragment hrefs untouched', () => {
    expect(sanitizeHref('https://example.com')).toBe('https://example.com');
    expect(sanitizeHref('http://example.com')).toBe('http://example.com');
    expect(sanitizeHref('mailto:ana@centurionhq.com')).toBe('mailto:ana@centurionhq.com');
    expect(sanitizeHref('#seccion')).toBe('#seccion');
    expect(sanitizeHref('/documentos/SDD-011')).toBe('/documentos/SDD-011');
    expect(sanitizeHref('docs/relativo.md')).toBe('docs/relativo.md');
  });

  it('rejects script-executing schemes, including mixed case and embedded whitespace', () => {
    expect(sanitizeHref('javascript:alert(1)')).toBe('#');
    expect(sanitizeHref('JavaScript:alert(1)')).toBe('#');
    expect(sanitizeHref('java\tscript:alert(1)')).toBe('#');
    expect(sanitizeHref('  javascript:alert(1)')).toBe('#');
    expect(sanitizeHref('data:text/html,<script>alert(1)</script>')).toBe('#');
    expect(sanitizeHref('vbscript:msgbox(1)')).toBe('#');
  });

  it('treats an empty href as safe but pointing nowhere', () => {
    expect(sanitizeHref('')).toBe('#');
    expect(sanitizeHref('   ')).toBe('#');
  });
});

describe('inlineToHtml href sanitizing', () => {
  it('renders a javascript: link as a safe # href instead of executing it', () => {
    // The literal example from the audit finding; WO-309 later fixes the unrelated
    // paren-in-href parsing limitation, so this only asserts the scheme never leaks through.
    const html = inlineToHtml('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<a href="#" rel="noopener noreferrer">click</a>');
  });

  it('renders a data: link as a safe # href', () => {
    expect(inlineToHtml('[x](data:text/html,evil)')).toBe('<a href="#" rel="noopener noreferrer">x</a>');
  });

  it('adds rel="noopener noreferrer" to every generated link', () => {
    expect(inlineToHtml('[prdmanager](https://prdmanager.dev)')).toContain('rel="noopener noreferrer"');
  });
});

describe('htmlToInline', () => {
  it('is the inverse of inlineToHtml for every supported mark', () => {
    expect(htmlToInline('<strong>negrita</strong>')).toBe('**negrita**');
    expect(htmlToInline('<em>cursiva</em>')).toBe('_cursiva_');
    expect(htmlToInline('<del>tachado</del>')).toBe('~~tachado~~');
    expect(htmlToInline('<a href="https://example.com">prdmanager</a>')).toBe('[prdmanager](https://example.com)');
  });

  it('un-escapes entities back to plain characters', () => {
    expect(htmlToInline('A &lt; B &amp; C')).toBe('A < B & C');
  });

  it('flattens a stray wrapping <div> (some browsers add one on Enter)', () => {
    expect(htmlToInline('<div>algo</div>')).toBe('algo');
  });
});

describe('round-trip: inlineToHtml <-> htmlToInline', () => {
  const samples = [
    'Texto normal.',
    '**negrita**',
    '_cursiva_',
    '~~tachado~~',
    '[prdmanager](https://example.com)',
    '**negrita _e itálica_** y **~~tachado~~** con [un link](https://prdmanager.dev)',
    'Texto con < y & sin escapar en el modelo.',
    'El paquete design/centurion-factory aísla el rediseño de packages/app y trabaja **solo con datos mock**.',
  ];

  it.each(samples)('recovers %s exactly', (text) => {
    expect(htmlToInline(inlineToHtml(text))).toBe(text);
  });
});

describe('reconcileBlocks', () => {
  it('keeps the id and author of blocks at an unchanged position', () => {
    const previous: DocumentBlock[] = [block('b1', 'h1', 'Viejo', { author: 'julia-paz' })];
    const [reconciled] = reconcileBlocks(previous, [{ type: 'h1', text: 'Nuevo' }], 'ana-rios');
    expect(reconciled).toEqual({ id: 'b1', type: 'h1', text: 'Nuevo', checked: undefined, author: 'julia-paz' });
  });

  it('attributes brand-new lines to the fallback author with a fresh id', () => {
    const [reconciled] = reconcileBlocks([], [{ type: 'p', text: 'Nueva línea' }], 'ana-rios');
    expect(reconciled?.author).toBe('ana-rios');
    expect(reconciled?.text).toBe('Nueva línea');
    expect(reconciled?.id).toBeTruthy();
  });
});
