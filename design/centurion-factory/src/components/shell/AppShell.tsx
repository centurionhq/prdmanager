import { Outlet } from 'react-router';
import styles from './AppShell.module.css';
import { BottomBar } from './BottomBar';
import { Sidebar } from './Sidebar';

/** The document title is set once, for every route, by `useDocumentTitle` in `RootLayout`. */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#contenido">
        Saltar al contenido
      </a>
      <Sidebar />
      <main id="contenido" className={styles.main} tabIndex={-1}>
        <Outlet />
      </main>
      <BottomBar />
    </div>
  );
}
