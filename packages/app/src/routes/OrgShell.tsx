/**
 * Layout for every `/o/:orgSlug/*` route (SDD-006 §Dashboard shell, WO-117): the org switcher, the
 * primary nav (projects / members / audit / profile / personal tokens / sign out) and an `<Outlet>` for the
 * nested screen. Nested routes read the resolved organization via `useOrgShellContext()` instead of
 * re-fetching `listOrganizations()` themselves.
 *
 * SDD-089/WO-697: the two account screens (perfil, tokens personales) now live at the organization level
 * and are reachable from here without belonging to any project, so the nav links them directly (Perfil and
 * Tokens) instead of sending Tokens through the legacy `/settings/tokens` redirect.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router';
import type { OrganizationSummary } from '@prdm/contracts';
import { listOrganizations, setActiveOrganization, signOut } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import { FormNotice } from '../components/FormNotice.js';
import { LoadingState } from '@prdm/ui';
import formStyles from '../styles/forms.module.css';
import styles from '../styles/dashboard.module.css';

/** The paths the personal-tokens screen answers on: its organization-level home (SDD-089) and the two
 * legacy entry points (`/settings/tokens`, `.../p/:projectSlug/ajustes/tokens-personales`) that now
 * redirect there. */
const PERSONAL_TOKENS_PATH = /^\/o\/[^/]+\/(?:p\/[^/]+\/)?ajustes\/tokens-personales$/;

/** SDD-077 D3: `NavLink` decides the current org destination and the stylesheet tells it apart by weight + color. */
function orgNavLinkClass({ isActive }: { isActive: boolean }): string | undefined {
  return isActive ? styles.active : undefined;
}

/** SDD-077 D3: the Tokens item covers paths that share no prefix — the legacy entry point, the project screen
 * it redirects to and the organization-level home it lands on (SDD-089) — so `NavLink`'s own matcher (which is
 * what declares `aria-current`) cannot mark it. This is the single hand-written exception SDD-077's
 * "alternativas descartadas" allows. */
function isTokensPath(pathname: string): boolean {
  return pathname === '/settings/tokens' || PERSONAL_TOKENS_PATH.test(pathname);
}

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

/** SDD-089/WO-697: the account screens (perfil, tokens personales) live at the organization level and are
 * reachable from either shell. They only need the slug the shell already resolved from the URL — never
 * `listOrganizations()[0]` (WO-607/FB-083) — and, since `ProjectShellContext extends OrgShellContext`, this
 * works unchanged whether the screen is mounted under `OrgShell` or under `ProjectShell`. */
export function useShellOrgSlug(): string {
  return useOrgShellContext().orgSlug;
}

export function OrgShell(): ReactElement {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { pathname } = useLocation();
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
  const tokensActive = isTokensPath(pathname);
  // SDD-089/WO-697: Tokens points straight at the organization-level screen. Only the not-found branch
  // (no resolved organization to build a path from) falls back to the legacy entry point, which redirects.
  const tokensLink = (
    <Link
      to={currentOrg ? `/o/${currentOrg.slug}/ajustes/tokens-personales` : '/settings/tokens'}
      aria-current={tokensActive ? 'page' : undefined}
      className={tokensActive ? styles.active : undefined}
    >
      Tokens
    </Link>
  );
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
            {tokensLink}
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
          <NavLink to={`/o/${currentOrg.slug}`} end className={orgNavLinkClass}>
            Proyectos
          </NavLink>
          <NavLink to={`/o/${currentOrg.slug}/ajustes/miembros`} end className={orgNavLinkClass}>
            Miembros
          </NavLink>
          <NavLink to={`/o/${currentOrg.slug}/ajustes/auditoria`} end className={orgNavLinkClass}>
            Auditoría
          </NavLink>
          <NavLink to={`/o/${currentOrg.slug}/ajustes/perfil`} end className={orgNavLinkClass}>
            Perfil
          </NavLink>
          {tokensLink}
          {signOutButton}
        </nav>
      </header>
      <main className={styles.content}>
        <Outlet context={{ orgSlug: currentOrg.slug, organizations, currentOrg } satisfies OrgShellContext} />
      </main>
    </div>
  );
}
