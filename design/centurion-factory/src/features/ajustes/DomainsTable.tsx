import { ChevronRight } from 'lucide-react';
import { Fragment, useRef, type ReactElement } from 'react';
import { Button, useToast } from '../../components';
import type { SsoSettings } from '../../data';
import { CLIPBOARD_ERROR, copyToClipboard, formatDate } from './lib';
import styles from './SsoPage.module.css';

export type SsoDomain = SsoSettings['domains'][number];

export interface DomainsTableProps {
  readonly domains: readonly SsoDomain[];
  readonly expandedDomain: string | null;
  readonly onToggleExpand: (domain: string) => void;
  readonly onVerify: (domain: string) => void;
}

interface TxtRecordPanelProps {
  readonly domain: string;
  readonly txtRecord: string;
  readonly onVerify: () => void;
}

/** The expanded TXT-record panel for a pending domain, with copy feedback for the record (WO-318). */
function TxtRecordPanel({ domain, txtRecord, onVerify }: TxtRecordPanelProps): ReactElement {
  const toast = useToast();
  const recordRef = useRef<HTMLInputElement>(null);

  async function handleCopy(): Promise<void> {
    const copied = await copyToClipboard(txtRecord);
    if (copied) {
      toast.show('Registro copiado');
      return;
    }
    recordRef.current?.select();
    toast.show(CLIPBOARD_ERROR);
  }

  return (
    <div className={styles.txtPanel}>
      <p className={styles.txtHint}>{`Agregá este registro TXT en el DNS de ${domain}. Puede tardar hasta una hora.`}</p>
      <div className={styles.txtRow}>
        <input ref={recordRef} readOnly className={`id ${styles.txtRecord}`} value={txtRecord} />
        <Button type="button" variant="secondary" onClick={handleCopy}>
          Copiar
        </Button>
        <Button type="button" variant="secondary" onClick={onVerify}>
          Verificar ahora
        </Button>
      </div>
    </div>
  );
}

/** "Dominios verificados" table with an expandable TXT-record row per pending domain (WO-307). */
export function DomainsTable({ domains, expandedDomain, onToggleExpand, onVerify }: DomainsTableProps): ReactElement {
  return (
    <table className={styles.domainsTable}>
      <caption className="visually-hidden">Dominios verificados</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.headerCell}>
            Dominio
          </th>
          <th scope="col" className={styles.headerCell}>
            Estado
          </th>
          <th scope="col" className={styles.headerCell}>
            <span className="visually-hidden">Detalle</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {domains.map((domain) => {
          const expanded = expandedDomain === domain.domain;
          return (
            <Fragment key={domain.domain}>
              <tr className={styles.row}>
                <td className={styles.cell}>
                  {domain.verified ? (
                    <span className={styles.domainName}>{domain.domain}</span>
                  ) : (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      className={styles.domainToggle}
                      onClick={() => onToggleExpand(domain.domain)}
                    >
                      <ChevronRight aria-hidden="true" size={16} className={expanded ? styles.chevronOpen : undefined} />
                      {domain.domain}
                    </button>
                  )}
                </td>
                <td className={styles.cell}>
                  <span className={domain.verified ? styles.statusOk : styles.statusPending}>
                    <span className={domain.verified ? styles.dotOk : styles.dotPending} aria-hidden="true" />
                    {domain.verified ? 'Verificado' : 'Pendiente de verificación'}
                  </span>
                </td>
                <td className={`${styles.cell} ${styles.domainMeta}`}>
                  {domain.verified && domain.since ? `desde ${formatDate(domain.since)}` : null}
                </td>
              </tr>
              {!domain.verified && expanded ? (
                <tr>
                  <td colSpan={3} className={styles.txtCell}>
                    <TxtRecordPanel domain={domain.domain} txtRecord={domain.txtRecord ?? ''} onVerify={() => onVerify(domain.domain)} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
