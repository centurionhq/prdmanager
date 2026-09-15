import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { OrgSwitcher } from './OrgSwitcher';
import styles from './ProyectosPage.module.css';

/** Top bar for /proyectos (no project shell): wordmark, org switcher, settings link and person. */
export function TopBar(): ReactElement {
  return (
    <div className={styles.topBar}>
      <div className={styles.topBarLeft}>
        <span className={styles.wordmark}>Centurion Factory</span>
        <span className={styles.topBarDivider} aria-hidden="true" />
        <OrgSwitcher />
      </div>
      <div className={styles.topBarRight}>
        <Link to="/ajustes/sso" className={styles.settingsLink}>
          Ajustes de la organización
        </Link>
        <div className={styles.person}>
          <span className={styles.avatar} aria-hidden="true">
            AR
          </span>
          <span className={styles.personName}>Ana Ríos</span>
        </div>
      </div>
    </div>
  );
}
