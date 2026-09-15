/** EntradaPage's static aside: how new feedback and artifacts arrive. */
import type { ReactElement } from 'react';
import styles from './EntradaPage.module.css';

export function EntradaAside(): ReactElement {
  return (
    <aside className={styles.aside}>
      <h2 className={styles.asideTitle}>Cómo llega lo nuevo</h2>
      <p className={styles.asideText}>
        Los asistentes lo registran por MCP con <span className="id">submit_feedback</span> mientras trabajan.
      </p>
      <p className={styles.asideText}>
        Desde la terminal, cualquier persona del equipo corre <span className="id">prdm feedback add</span>.
      </p>
    </aside>
  );
}
