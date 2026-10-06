import { useId, useState, type ReactElement } from 'react';
import { Drawer } from '../../components/Drawer/Drawer';
import { ErrorState } from '../../components/ErrorState/ErrorState';
import { buildKpis, type PlantaKpi, type PlantaKpiDetail, type PlantaKpiNote } from './planta-overview-data';
import styles from './PlantaKpiStrip.module.css';

const COMMITS_DRAWER_WIDTH = 640;

function filesCopy(count: number): string {
  return `${count} ${count === 1 ? 'archivo' : 'archivos'}`;
}

function CommitsTable({ rows }: { readonly rows: PlantaKpiDetail['rows'] }): ReactElement {
  return (
    <div className={styles.commitsScroll} tabIndex={0} role="group" aria-label="Commits de la lista">
      <table className={styles.commitsTable}>
        <thead>
          <tr>
            <th scope="col">Commit</th>
            <th scope="col">Asunto</th>
            <th scope="col">Autor</th>
            <th scope="col">Fecha</th>
            <th scope="col">Archivos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.sha}>
              <td>
                <span className="id">{row.sha}</span>
                {row.gap === 'dangling_refs' ? <span className={styles.commitDangling}> ref colgante</span> : null}
              </td>
              <td>{row.subject}</td>
              <td>{row.author}</td>
              <td>{row.date}</td>
              <td className="num">{filesCopy(row.files)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** WO-669 (SDD-080 D6/D9): a commit KPI as a control that opens its drawer. Same pattern as `LineOrdersDrawer`. */
function CommitsKpi({ kpi, detail }: { readonly kpi: PlantaKpi; readonly detail: PlantaKpiDetail }): ReactElement {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      <button
        type="button"
        className={`${styles.value} ${styles.control} num`}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${kpi.label}: ${kpi.value}`}
        onClick={() => setOpen(true)}
      >
        {kpi.value}
      </button>
      <span className={styles.percent}>{kpi.percent}</span>
      <Drawer open={open} title={kpi.label} onClose={() => setOpen(false)} width={COMMITS_DRAWER_WIDTH}>
        <div id={panelId} className={styles.commitsBody}>
          <p>{detail.definition}</p>
          <div className={styles.commitsCounts}>
            <p className="num">{detail.count}</p>
            {detail.dangling ? <p className="num">{detail.dangling}</p> : null}
          </div>
          {detail.rows.length === 0 ? <p>No hay commits en esta lista.</p> : <CommitsTable rows={detail.rows} />}
          {detail.truncatedCopy ? <p>{detail.truncatedCopy}</p> : null}
        </div>
      </Drawer>
    </>
  );
}

/** WO-672 (SDD-081 D7): how many completed orders the median leaves out, with the list behind a details. */
function UnmeasuredNote({ note }: { readonly note: PlantaKpiNote }): ReactElement {
  return (
    <>
      <span className={styles.label}>{note.context}</span>
      <details className={styles.unmeasuredDetails}>
        <summary className={styles.unmeasuredSummary}>{note.summary}</summary>
        <ul className={styles.unmeasuredList} aria-label="Órdenes sin medición">
          {note.rows.map((row) => (
            <li key={row.id} className={styles.unmeasuredRow}>
              <a className={`id ${styles.unmeasuredId}`} href="#">
                {row.id}
              </a>
              <span>{row.reason}</span>
              <span className={styles.unmeasuredDates}>{row.dates}</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

/** SDD-085: the strip's own states, mirrored from the app (`routes/Planta.tsx`). */
export type PlantaKpiStripState = 'listo' | 'cargando' | 'error' | 'primer_reporte';

export interface PlantaKpiStripProps {
  readonly estado?: PlantaKpiStripState;
  readonly onRetry?: () => void;
}

const NOOP = (): void => undefined;
const SKELETON_CELLS = [0, 1, 2, 3, 4] as const;

/** The 5-up KPI strip separated by rules, from canvas/Main.dc.html. */
export function PlantaKpiStrip({ estado = 'listo', onRetry = NOOP }: PlantaKpiStripProps = {}): ReactElement {
  const kpis = buildKpis();

  if (estado === 'error') {
    return (
      <section className={styles.strip} aria-label="Indicadores de la planta">
        <div className={styles.plate}>
          <ErrorState title="No pudimos cargar los indicadores" body="El servidor no respondió. La línea y las órdenes siguen en pie." onRetry={onRetry} />
        </div>
      </section>
    );
  }

  if (estado === 'primer_reporte') {
    return (
      <section className={styles.strip} aria-label="Indicadores de la planta">
        <div className={styles.plate}>
          <p className={styles.firstReport}>Todavía no hay reporte de CI: los indicadores llegan con el primero</p>
          <a className={styles.firstReportLink} href="#">
            Conectar mi entorno
          </a>
        </div>
      </section>
    );
  }

  if (estado === 'cargando') {
    return (
      <section className={styles.strip} aria-label="Indicadores de la planta" aria-busy="true">
        {SKELETON_CELLS.map((cell) => (
          <div key={cell} className={styles.item} aria-hidden="true">
            <span className={styles.skeletonBar} />
            <span className={`${styles.skeletonBar} ${styles.skeletonValue}`} />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className={styles.strip} aria-label="Indicadores de la planta">
      {kpis.map((kpi) => (
        <div key={kpi.label} className={styles.item}>
          <span className={styles.label}>{kpi.label}</span>
          {kpi.detail ? (
            <CommitsKpi kpi={kpi} detail={kpi.detail} />
          ) : (
            <>
              <span className={`${styles.value} num`}>{kpi.value}</span>
              {kpi.percent ? <span className={styles.percent}>{kpi.percent}</span> : null}
            </>
          )}
          {kpi.note ? <UnmeasuredNote note={kpi.note} /> : null}
        </div>
      ))}
    </section>
  );
}
