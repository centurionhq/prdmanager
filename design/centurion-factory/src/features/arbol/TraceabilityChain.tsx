/** TraceabilityPanel's "Trazabilidad" chain: origin, feature, blueprints, órdenes, commits, código. */
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import type { Feature } from '../../data';
import styles from './TraceabilityPanel.module.css';
import type { TraceabilityChain as TraceabilityChainData } from './traceability';

export interface TraceabilityChainProps {
  readonly feature: Feature;
  readonly chain: TraceabilityChainData;
}

export function TraceabilityChain({ feature, chain }: TraceabilityChainProps): ReactElement {
  return (
    <div className={styles.chainSection}>
      <h3 className={styles.sectionTitle}>Trazabilidad</h3>
      <div className={styles.chain}>
        <div className={styles.chainColumn}>
          <span className={styles.chainDot} aria-hidden="true" />
          <span className={styles.chainLabel}>Origen</span>
          {chain.origin.length > 0 ? (
            chain.origin.map((id) => (
              <span key={id} className="id">
                {id}
              </span>
            ))
          ) : (
            <span className={styles.chainMuted}>Sin origen registrado</span>
          )}
        </div>
        <div className={styles.chainColumn}>
          <span className={styles.chainDot} aria-hidden="true" />
          <span className={styles.chainLabel}>Feature</span>
          <span className="id">{feature.id}</span>
        </div>
        <div className={styles.chainColumn}>
          <span className={styles.chainDot} aria-hidden="true" />
          <span className={styles.chainLabel}>Blueprints</span>
          {chain.blueprintIds.length > 0 ? (
            <span className={styles.blueprintLinks}>
              {chain.blueprintIds.map((id) => (
                <Link key={id} to={`/documentos/${id}`} className="id">
                  {id}
                </Link>
              ))}
            </span>
          ) : (
            <span className={styles.chainMuted}>Sin blueprints</span>
          )}
        </div>
        <div className={styles.chainColumn}>
          <span className={styles.chainDot} aria-hidden="true" />
          <span className={styles.chainLabel}>Órdenes</span>
          <Link to={`/ordenes?feature=${feature.id}`} className={styles.chainNumber}>
            {chain.ordersLabel}
          </Link>
        </div>
        <div className={styles.chainColumn}>
          <span className={styles.chainDot} aria-hidden="true" />
          <span className={styles.chainLabel}>Commits</span>
          <span className={styles.chainNumber}>{chain.commitsLabel}</span>
        </div>
        <div className={styles.chainColumn}>
          <span className={[styles.chainDot, chain.codeInSync ? styles.chainDotSenal : styles.chainDotParo].join(' ')} aria-hidden="true" />
          <span className={styles.chainLabel}>Código</span>
          <span className={[styles.chainNumber, chain.codeInSync ? styles.codeSynced : styles.codeOutOfSync].join(' ')}>{chain.codeLabel}</span>
        </div>
      </div>
    </div>
  );
}
