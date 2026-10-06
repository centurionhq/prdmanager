import { describe, expect, it } from 'vitest';
import { parseInlineTitle, toPlainTitle } from '../../src/lib/wo-title.js';

/**
 * WO-751 (SDD-105 D5, decisión T1 de prdm-pm): `toPlainTitle` es el texto plano de la primera línea de un
 * título -- sin marcas de markdown -- y `parseInlineTitle` lo parte en texto + tramos de código, que es lo
 * que el panel dibuja como pieza mono. El caso real que motivó el helper es FB-263: el título de una orden
 * llegaba crudo, con `**`, acentos graves y una ruta adentro.
 */
describe('toPlainTitle', () => {
  it('drops backticks but keeps what they wrapped', () => {
    expect(toPlainTitle('Tipar `listCommits` en la app')).toBe('Tipar listCommits en la app');
  });

  it('keeps a path that was inside code spans, without the backticks', () => {
    expect(toPlainTitle('D5 en `packages/app/src/routes/Planta.tsx:263-300` (lectura defensiva)')).toBe(
      'D5 en packages/app/src/routes/Planta.tsx:263-300 (lectura defensiva)',
    );
  });

  it('strips emphasis, strong and strikethrough marks', () => {
    expect(toPlainTitle('**WO-B** (app: _Planta_) y ~~viejo~~ *nuevo*')).toBe('WO-B (app: Planta) y viejo nuevo');
  });

  it('strips the double-underscore strong form', () => {
    expect(toPlainTitle('__Fuerte__ con texto')).toBe('Fuerte con texto');
  });

  it('leaves snake_case identifiers alone', () => {
    expect(toPlainTitle('Módulo wo_title y su archivo wo-title.ts')).toBe('Módulo wo_title y su archivo wo-title.ts');
  });

  it('keeps the text of a markdown link and drops its url', () => {
    expect(toPlainTitle('[SDD-105](docs/sdd/SDD-105-el-arbol.md) dice lo que muestra')).toBe('SDD-105 dice lo que muestra');
  });

  it('keeps the alt text of an image and drops its url', () => {
    expect(toPlainTitle('![captura del panel](https://ejemplo.test/panel.png) del caso real')).toBe('captura del panel del caso real');
  });

  it('reads only the first line', () => {
    expect(toPlainTitle('Título de la orden\n\nCuerpo con `detalle` y más texto')).toBe('Título de la orden');
  });

  it('drops a heading mark at the start of the line', () => {
    expect(toPlainTitle('# Título de sección')).toBe('Título de sección');
  });

  it('renders no HTML: script and style bodies and tags are gone', () => {
    const raw = '<script>alert(1)</script>Negrita <b>fuerte</b> y <img src="x" onerror="alert(2)"> lista';
    const plain = toPlainTitle(raw);

    expect(plain).toBe('Negrita fuerte y lista');
    expect(plain).not.toContain('<');
  });

  it('does not treat angle brackets inside a code span as HTML', () => {
    expect(toPlainTitle('Tipar `Map<string, T>` bien')).toBe('Tipar Map<string, T> bien');
  });

  it('collapses whitespace and trims the line', () => {
    expect(toPlainTitle('  Título    con   espacios  ')).toBe('Título con espacios');
  });

  it('returns an empty string for an empty or blank body', () => {
    expect(toPlainTitle('')).toBe('');
    expect(toPlainTitle('   \n\n  ')).toBe('');
  });

  it('drops a stray, unclosed backtick', () => {
    expect(toPlainTitle('Título raro ` sin cerrar')).toBe('Título raro sin cerrar');
  });
});

describe('parseInlineTitle', () => {
  it('splits text and code so the panel can draw the code as a mono piece', () => {
    expect(parseInlineTitle('**WO-B** — D5 en `packages/app/src/routes/Planta.tsx:263-300` (etiqueta)')).toEqual([
      { text: 'WO-B — D5 en ', code: false },
      { text: 'packages/app/src/routes/Planta.tsx:263-300', code: true },
      { text: ' (etiqueta)', code: false },
    ]);
  });

  it('keeps a code span verbatim, with its own spaces', () => {
    expect(parseInlineTitle('Ver `a  b` acá')).toEqual([
      { text: 'Ver ', code: false },
      { text: 'a  b', code: true },
      { text: ' acá', code: false },
    ]);
  });

  it('never returns empty parts', () => {
    expect(parseInlineTitle('`solo código`')).toEqual([{ text: 'solo código', code: true }]);
    expect(parseInlineTitle('')).toEqual([]);
    expect(parseInlineTitle('``')).toEqual([]);
  });

  it('joins back to exactly the plain title', () => {
    const raw = '**WO-B** (app: `Planta.tsx`) y [FR-044](docs/fr.md)';
    expect(parseInlineTitle(raw).map((part) => part.text).join('')).toBe(toPlainTitle(raw));
  });

  it('treats every part as plain when there is no backtick', () => {
    expect(parseInlineTitle('Título simple')).toEqual([{ text: 'Título simple', code: false }]);
  });
});
