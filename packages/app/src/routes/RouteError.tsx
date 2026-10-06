/**
 * SDD-103 (FR-043): the three `errorElement`s of the route tree. A render error inside a screen is contained
 * where `router.tsx` declares the boundary (D1): below each shell, so the sidebar / org header stay mounted and
 * the plate takes the `Outlet`'s place; `RootScreenError` is the last resort when the chrome itself fails.
 *
 * The plate is `NotFoundPanel` extended (D2). On screen goes only the code (D4); the raw message and stack go to
 * the console under that same code, and to the screen only in a real dev build.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { useOutletContext, useLocation, useNavigate, useParams, useRouteError } from 'react-router';
import {
  NotFoundPanel,
  type NotFoundPanelAction,
  type NotFoundPanelDestination,
} from '../components/NotFoundPanel/NotFoundPanel.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import type { OrgShellContext } from './OrgShell.js';
import styles from './RouteError.module.css';

const ERROR_TITLE = 'No pudimos mostrar esta pantalla';
const ERROR_MARK = 'Algo salió mal';
const ERROR_BODY =
  'El error es de esta pantalla, no de tu cuenta. El resto de la aplicación sigue funcionando: podés seguir desde otra sección.';
const CODE_LABEL = 'Código del error';
const CODE_NOTE = 'No incluye tus datos. Pasale este código a quien administra el proyecto.';

/** The vitest runner also sets `DEV`; the raw detail must stay out of the DOM there (SDD-103 D4). */
const SHOW_RAW_DETAIL = import.meta.env.DEV && import.meta.env.MODE !== 'test';

/** `ERR-` + two groups of 4 uppercase hex digits. Not a secret: it only ties the plate to a console line. */
function generateErrorCode(): string {
  const group = (): string => Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
  return `ERR-${group()}-${group()}`;
}

function rawDetail(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

interface RouteErrorPlateProps {
  readonly action?: NotFoundPanelAction;
  readonly destinations?: readonly NotFoundPanelDestination[];
}

function RouteErrorPlate({ action, destinations }: RouteErrorPlateProps): ReactElement {
  useDocumentTitle(ERROR_TITLE);
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();
  const [code] = useState(generateErrorCode);

  // Once per captured error, with the same code the person sees (a re-render must not log it again).
  useEffect(() => {
    console.error(`[route-error] ${code}`, error);
  }, [code, error]);

  // D6: `revalidate()` is not enough — with no loaders there is no revalidation cycle, so the boundary never
  // resets. React Router does reset it when the location object changes, so retrying is a `replace` to the same
  // URL: a fresh `location.key` remounts the screen, adds no history entry, and leaving the route clears it too.
  const retry = (): void => void navigate(location, { replace: true });

  return (
    <>
      <NotFoundPanel
        alert
        mark={ERROR_MARK}
        title={ERROR_TITLE}
        body={ERROR_BODY}
        code={{ label: CODE_LABEL, value: code, note: CODE_NOTE }}
        onRetry={retry}
        action={action}
        destinations={destinations}
      />
      {SHOW_RAW_DETAIL ? (
        <pre role="note" className={styles.detail}>
          {rawDetail(error)}
        </pre>
      ) : null}
    </>
  );
}

export function ProjectScreenError(): ReactElement {
  const { orgSlug = '', projectSlug = '' } = useParams<{ orgSlug: string; projectSlug: string }>();
  const base = `/o/${orgSlug}/p/${projectSlug}`;
  const destinations = [
    { to: base, label: 'Ir a la Planta', end: true },
    { to: `${base}/documents`, label: 'Ir a Documentos' },
  ];
  return <RouteErrorPlate destinations={destinations} />;
}

export function OrgScreenError(): ReactElement {
  const { orgSlug = '' } = useParams<{ orgSlug: string }>();
  const context = useOutletContext<OrgShellContext | undefined>();
  const name = context?.currentOrg.name ?? orgSlug;
  return <RouteErrorPlate action={{ to: `/o/${orgSlug}`, label: `Ver los proyectos de ${name}` }} />;
}

/** Last resort (D1c): no chrome to keep, so no navigation either — just the plate and its retry. */
export function RootScreenError(): ReactElement {
  return <RouteErrorPlate />;
}
