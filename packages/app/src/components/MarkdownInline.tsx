/**
 * Markdown **en línea** para una celda (WO-751, SDD-105 D5, decisión T1 de prdm-pm): el título de una orden
 * es markdown y la columna «Título» del panel lo mostraba crudo (`**`, acentos graves, una ruta cortada a
 * mitad de palabra -- FB-263). Una celda no puede contener párrafos: acá no se interpretan bloques, sólo se
 * pinta la primera línea como texto plano y los tramos entre acentos graves como pieza mono (`.cod` del
 * comp). El endurecido es por construcción: no hay HTML (las etiquetas se descartan) ni imágenes -- ver el
 * detalle en `lib/wo-title.ts`.
 *
 * El corte a dos líneas es CSS y el texto completo viaja en el `title` (decisión T2), así que la celda
 * nunca cambia de alto por un título largo.
 */
import { Fragment, type ReactElement } from 'react';
import { parseInlineTitle, toPlainTitle } from '../lib/wo-title.js';
import styles from './MarkdownInline.module.css';

export interface MarkdownInlineProps {
  /** El título crudo tal como lo publica el grafo (puede ser una primera línea con markdown). */
  readonly text: string;
}

export function MarkdownInline({ text }: MarkdownInlineProps): ReactElement {
  return (
    <span className={styles.inline} title={toPlainTitle(text)}>
      {parseInlineTitle(text).map((part, index) =>
        part.code ? (
          <code key={`code-${index}`} className={styles.code}>
            {part.text}
          </code>
        ) : (
          <Fragment key={`text-${index}`}>{part.text}</Fragment>
        ),
      )}
    </span>
  );
}
