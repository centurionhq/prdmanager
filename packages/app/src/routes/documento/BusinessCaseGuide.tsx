/**
 * The writing guide beside the editor of a Business Case (SDD-053/PRD-033 R2, canvas `ConstruirNegocio.dc.html`):
 * the four required sections in order, what is expected in each, which ones are already written, and what
 * publishing unlocks -- said while there is still time to care, not when publishing is refused.
 *
 * It reads the same live `Y.Text('body')` the editor writes, so it tracks what the person is typing without a
 * reload and without a second source of truth about the document's content.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useCollabDocumentContext } from '../../collab/collab-document-context.js';
import { businessCaseSectionStates } from './business-case-sections.js';
import styles from './BusinessCaseGuide.module.css';

export function BusinessCaseGuide(): ReactElement {
  const { provider } = useCollabDocumentContext();
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!provider) return;
    const text = provider.document.getText('body');
    const sync = (): void => setBody(text.toString());
    sync();
    text.observe(sync);
    return () => text.unobserve(sync);
  }, [provider]);

  const sections = businessCaseSectionStates(body);
  const written = sections.filter((section) => section.written).length;

  return (
    <aside aria-label="Guía del caso de negocio" className={styles.guide}>
      <div className={styles.heading}>
        <span className={styles.title}>Cuatro cosas, en orden</span>
        <span className={`num ${styles.progress}`}>
          {written} de {sections.length} escritas
        </span>
      </div>

      <ol className={styles.list}>
        {sections.map((section) => (
          <li
            key={section.heading}
            className={[styles.item, section.written ? styles.itemWritten : null, section.current ? styles.itemCurrent : null].filter(Boolean).join(' ')}
            data-escrita={section.written}
            {...(section.current ? { 'aria-current': 'step' as const } : {})}
          >
            <span className={[styles.marker, section.written ? styles.markerOn : null].filter(Boolean).join(' ')} aria-hidden="true" />
            <span className={styles.body}>
              <span className={styles.label}>{section.label}</span>
              <span className={styles.hint}>{section.hint}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className={styles.aside}>
        Cuando lo publiques, esta iniciativa queda aprobada y recién ahí alguien puede escribir los requisitos colgados de ella. Sin este documento publicado, esos requisitos no arrancan.
      </p>
    </aside>
  );
}
