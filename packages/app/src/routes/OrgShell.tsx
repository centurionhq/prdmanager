/**
 * Layout for every `/o/:orgSlug/*` route (SDD-006 §Dashboard shell, WO-117): the org switcher, the
 * primary nav (projects / members / personal tokens / sign out) and an `<Outlet>` for the nested screen.
 * Nested routes read the resolved organization via `useOrgShellContext()` instead of re-fetching
 * `listOrganizations()` themselves.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link, Outlet, useNavigate, useOutletContext, useParams } from 'react-router';
import type { OrganizationSummary } from '@prdm/contracts';
import { listOrganizations, setActiveOrganization, signOut } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { FormNotice } from '../components/FormNotice.js';
import { LoadingState } from '@prdm/ui';
import formStyles from '../styles/forms.module.css';
import styles from '../styles/dashboard.module.css';

export interface OrgShellContext {
  orgSlug: string;
  organizations: OrganizationSummary[];
  currentOrg: OrganizationSummary;
}

/** Nested route components (`ProjectsDashboard`, org/project settings screens) call this instead of
 * re-fetching the organization list themselves. */
export function useOrgShellContext(): OrgShellContext {
  return useOutletContext<OrgShellContext>();
}

export function OrgShell(): ReactElement {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOrganizations()
      .then((orgs) => {
        if (!cancelled) setOrganizations(orgs);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug]);

  async function handleSwitch(nextSlug: string): Promise<void> {
    const next = organizations?.find((org) => org.slug === nextSlug);
    if (!next) return;
    try {
      await setActiveOrganization(next.id);
    } finally {
      navigate(`/o/${next.slug}`);
    }
  }

  async function handleSignOut(): Promise<void> {
    await signOut();
    navigate('/login', { replace: true });
  }

  if (error) {
    return (
      <div className={formStyles.page}>
        <div className={formStyles.card}>
          <FormError message={error} />
        </div>
      </div>
    );
  }

  if (!organizations) {
    return <LoadingState label="Cargando organizaciones…" />;
  }

  const currentOrg = organizations.find((org) => org.slug === orgSlug);

  // Un switcher solo existe si hay algo que cambiar (SDD-077 D1); con una sola organización se
  // muestra su nombre como texto estático (o nada, si la organización pedida no existe).
  let switcher: ReactElement | null = null;
  if (organizations.length > 1) {
    switcher = (
      <select
        id="org-switcher"
        name="organization"
        className={styles.orgSwitcher}
        value={currentOrg?.slug ?? ''}
        onChange={(e) => void handleSwitch(e.target.value)}
        aria-label="Organización"
      >
        {currentOrg ? null : (
          <option value="" disabled>
            Elegí una organización
          </option>
        )}
        {organizations.map((org) => (
          <option key={org.id} value={org.slug}>
            {org.name}
          </option>
        ))}
      </select>
    );
  } else if (currentOrg) {
    switcher = <span className={styles.orgName}>{currentOrg.name}</span>;
  }
  const signOutButton = (
    <button type="button" className={styles.signOutButton} onClick={() => void handleSignOut()}>
      Cerrar sesión
    </button>
  );

  if (!currentOrg) {
    return (
      <div className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.brand}>prdm</span>
          {switcher}
          <nav className={styles.nav}>
            <Link to="/settings/tokens">Tokens</Link>
            {signOutButton}
          </nav>
        </header>
        <main className={styles.content}>
          <FormNotice title="Organización no encontrada" subtitle="No pertenecés a esta organización o no existe." />
        </main>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>prdm</span>
        {switcher}
        <nav className={styles.nav}>
          <Link to={`/o/${currentOrg.slug}`}>Proyectos</Link>
          <Link to={`/o/${currentOrg.slug}/ajustes/miembros`}>Miembros</Link>
          <Link to={`/o/${currentOrg.slug}/ajustes/auditoria`}>Auditoría</Link>
          <Link to="/settings/tokens">Tokens</Link>
          {signOutButton}
        </nav>
      </header>
      <main className={styles.content}>
        <Outlet context={{ orgSlug: currentOrg.slug, organizations, currentOrg } satisfies OrgShellContext} />
      </main>
    </div>
  );
}
