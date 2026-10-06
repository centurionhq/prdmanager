/**
 * Títulos legibles (WO-751, SDD-105 D5, decisión T1 de prdm-pm): el `title` de un documento suele ser la
 * primera línea de un cuerpo markdown -- `**WO-B (app: el panel)** — D5 en \`packages/app/src/routes/...\``
 * -- y ni el maestro (un árbol: no puede montar un renderizador de bloques por fila) ni una celda de tabla
 * (no puede contener párrafos) pueden mostrar eso crudo. Este módulo es la pieza pura que usan los dos:
 *
 * - `toPlainTitle(raw)`: la primera línea, sin marcas de markdown, para el `title` nativo de la fila.
 * - `parseInlineTitle(raw)`: la misma primera línea partida en texto y tramos de código, para que el panel
 *   pinte los tramos entre acentos graves como pieza mono (`.cod` del comp) en vez de mostrar los backticks.
 *
 * Es literal, no un intérprete de markdown (decisión T1): no hay HTML, no hay imágenes -- las etiquetas se
 * descartan y el contenido de un `<script>`/`<style>` se va entero, así que nada de lo que llegue en un
 * título puede convertirse en markup vivo. Los links conservan su texto y pierden su URL, y los segmentos
 * de código se copian verbatim (por eso un `<` adentro de backticks no se toca).
 */

/** Un tramo de la primera línea: `code` marca lo que estaba entre acentos graves. */
export interface InlineTitlePart {
  readonly text: string;
  readonly code: boolean;
}

const LINE_BREAK = /\r?\n/;
/** El elemento entero, contenido incluido: dejar el cuerpo de un `<script>` como texto visible no aporta nada. */
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** Cualquier etiqueta HTML (`<b>`, `<img onerror=...>`); un `<` suelto o dentro de un code span no matchea. */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const STRONG_STAR = /\*\*([\s\S]+?)\*\*/g;
const STRONG_UNDERSCORE = /__([\s\S]+?)__/g;
const STRIKE = /~~([\s\S]+?)~~/g;
/** `*nuevo*` sí, `2 * 3 * 4` no: un énfasis de markdown no arranca con un espacio adentro. */
const EMPHASIS_STAR = /\*(?!\s)([^*\n]+?)\*/g;
/** `_Planta_` sí, `wo_title` no: los guiones bajos sólo cierran énfasis en un borde de palabra. */
const EMPHASIS_UNDERSCORE = /(?<![\w])_(?!\s)([^_\n]+?)_(?![\w])/g;
const HEADING_MARK = /^\s*#{1,6}\s+/;
const WHITESPACE_RUN = /\s+/g;

function stripInlineMarkdown(text: string): string {
  return text
    .replace(SCRIPT_OR_STYLE, '')
    .replace(HTML_TAG, '')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(STRONG_STAR, '$1')
    .replace(STRONG_UNDERSCORE, '$1')
    .replace(STRIKE, '$1')
    .replace(EMPHASIS_STAR, '$1')
    .replace(EMPHASIS_UNDERSCORE, '$1')
    .replace(HEADING_MARK, '');
}

/** First line of the raw body, with its inline markdown marks removed. Never multi-line: the line is the unit. */
export function toPlainTitle(raw: string): string {
  return parseInlineTitle(raw)
    .map((part) => part.text)
    .join('');
}

/**
 * Splits the first line into plain text and code runs. The backtick pairs are balanced the way markdown
 * balances them: an odd opening with no closing backtick stays as text (and its backtick disappears, since
 * the title must not show the mark either).
 */
export function parseInlineTitle(raw: string): readonly InlineTitlePart[] {
  const firstLine = raw.split(LINE_BREAK, 1)[0] ?? '';
  const segments = firstLine.split('`');
  const merged: { text: string; code: boolean }[] = [];

  segments.forEach((segment, index) => {
    const isCode = index % 2 === 1 && index < segments.length - 1;
    const text = isCode ? segment : stripInlineMarkdown(segment);
    if (text === '') return;
    const previous = merged[merged.length - 1];
    if (previous && previous.code === isCode) previous.text += text;
    else merged.push({ text, code: isCode });
  });

  const parts = merged.map((part) => (part.code ? part : { text: part.text.replace(WHITESPACE_RUN, ' '), code: false }));
  if (parts.length === 0) return [];
  // Sólo los bordes de la línea: el espacio que separa un code span de su texto vecino es contenido.
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  first.text = first.text.replace(/^\s+/, '');
  last.text = last.text.replace(/\s+$/, '');

  return parts.filter((part) => part.text !== '');
}
