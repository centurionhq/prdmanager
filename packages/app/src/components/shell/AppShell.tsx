/**
 * Project-scoped app shell (SDD-013 §"Shell y router", ported from `design/centurion-factory`'s own
 * `AppShell`): sidebar on desktop, bottom bar on mobile, both fed by real org/project/session data
 * resolved once by `routes/ProjectShell.tsx` — this component itself never calls the API. Unlike the
 * mock's own `AppShell` (which renders `<Outlet/>` directly, since it has no per-route context to
 * forward), this one takes `children` so its caller can wrap the nested route in `<Outlet context={...}>`
 * itself.
 */
import type { ReactElement, ReactNode } from 'react';
import { BottomBar } from './BottomBar.js';
import { Sidebar } from './Sidebar.js';
import styles from './AppShell.module.css';

export interface AppShellData {
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly orgName: string;
  readonly projectName: string;
  readonly personName: string;
  readonly personRole: string;
  readonly driftErrorCount: number;
}

export function AppShell({ data, children }: { readonly data: AppShellData; readonly children: ReactNode }): ReactElement {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#contenido">
        Saltar al contenido
      </a>
      <Sidebar data={data} />
      <main id="contenido" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      <BottomBar data={data} />
    </div>
  );
}
