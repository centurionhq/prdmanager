import { useEffect } from 'react';
import { Outlet, useMatches } from 'react-router';
import type { RouteHandle } from '../../router';
import styles from './AppShell.module.css';
import { BottomBar } from './BottomBar';
import { documentTitle } from './nav';
import { Sidebar } from './Sidebar';

function useRouteTitle(): string | undefined {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle as RouteHandle | undefined;
    if (handle?.title) return handle.title;
  }
  return undefined;
}

export function AppShell() {
  const title = useRouteTitle();

  useEffect(() => {
    document.title = documentTitle(title);
  }, [title]);

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
