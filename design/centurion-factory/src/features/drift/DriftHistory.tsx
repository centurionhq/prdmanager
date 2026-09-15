import type { ReactElement } from 'react';
import { reportHistory } from './drift-data';
import { formatDate } from './drift-format';
import styles from './DriftHistory.module.css';

/** "Historial": every past baseline report on main, from canvas/Drift.dc.html. "Ver historial" in the
 * page header is a plain #historial anchor, so the browser scrolls here without any JS. */
export function DriftHistory(): ReactElement {
  const reports = reportHistory();

  return (
    <div id="historial" className={styles.section}>
      <h2 className={styles.title}>Historial</h2>
      <table className={styles.table}>
        <caption className="visually-hidden">Historial de reportes de drift de main</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.headerCell}>
              Fecha
            </th>
            <th scope="col" className={styles.headerCell}>
              Commit
            </th>
            <th scope="col" className={styles.headerCell}>
              Token
            </th>
            <th scope="col" className={`${styles.headerCell} ${styles.headerCellEnd}`}>
              Issues
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={report.id} className={styles.row}>
              <td className={`${styles.cell} num`}>{formatDate(report.createdAt)}</td>
              <td className={styles.cell}>
                <span className={`id ${styles.commit}`}>{report.headSha}</span>
              </td>
              <td className={styles.cell}>
                <span className={`id ${styles.token}`}>{report.tokenPrefix}…</span>
              </td>
              <td className={`${styles.cell} ${styles.cellEnd} num`}>{report.issueCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
