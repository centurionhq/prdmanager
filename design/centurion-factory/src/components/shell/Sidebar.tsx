import { NavLink } from 'react-router';
import styles from './Sidebar.module.css';
import { APP_NAME, PRIMARY_NAV } from './nav';

const DRIFT_ERRORS = 3;
const INBOX_NEW = 2;

function Badge({ to }: { to: string }) {
  if (to === '/drift') {
    return (
      <span className={styles.andonBadge}>
        <span aria-hidden="true" className="num">
          {DRIFT_ERRORS}
        </span>
        <span className="visually-hidden">{DRIFT_ERRORS} errores de drift</span>
      </span>
    );
  }
  if (to === '/entrada') {
    return (
      <span className={styles.countBadge}>
        <span aria-hidden="true" className="num">
          {INBOX_NEW}
        </span>
        <span className="visually-hidden">{INBOX_NEW} sin triar</span>
      </span>
    );
  }
  return null;
}

export function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>{APP_NAME}</div>
      <nav aria-label="Navegación principal">
        <ul className={styles.list}>
          {PRIMARY_NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? `${styles.link} ${styles.active}` : styles.link)}
              >
                <span className={styles.label}>{item.label}</span>
                <Badge to={item.to} />
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.footer}>
        <div className={styles.person}>
          <span className={styles.avatar} aria-hidden="true">
            AR
          </span>
          <span className={styles.personText}>
            <span className={styles.personName}>Ana Ríos</span>
            <span className={styles.personRole}>Admin de proyecto</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
