/**
 * `/o/:orgSlug/ajustes/auditoria` (SDD-013 §"Shell y router"): the organization-wide redacted audit
 * trail (WO-342's `getOrgAuditLog`), spanning every project plus org-level actions (invitations,
 * membership) — same table, exact-action filter and "Cargar más" keyset pagination as the project-scoped
 * screen (WO-365).
 *
 * Deliberately manages its own `cargando`/`error`/`listo` state instead of `useApiQuery`, for the same
 * reason `AjustesAuditoria.tsx` does: that hook can't append a further page or reset an in-flight fetch
 * when the action filter changes mid-load.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { AuditLogEntryDto } from '@prdm/contracts';
import { EmptyState, ErrorState, Skeleton } from '../components/index.js';
import { getOrgAuditLog } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useOrgShellContext } from './OrgShell.js';
import { AuditLogTable } from './audit-log-table.js';
import styles from '../styles/forms.module.css';

interface State {
  items: AuditLogEntryDto[];
  nextCursor: string | null;
}

export function OrgAjustesAuditoria(): ReactElement {
  const { orgSlug } = useOrgShellContext();
  const [action, setAction] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  useDocumentTitle('Auditoría de la organización');

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    getOrgAuditLog(orgSlug, { action: action || undefined })
      .then((page) => {
        if (!cancelled) setState({ items: page.items, nextCursor: page.nextCursor });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, action, retryTick]);

  function handleFilterSubmit(event: FormEvent): void {
    event.preventDefault();
    setAction(actionInput.trim());
  }

  async function handleLoadMore(): Promise<void> {
    if (!state?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await getOrgAuditLog(orgSlug, { action: action || undefined, cursor: state.nextCursor });
      setState((prev) => ({ items: [...(prev?.items ?? []), ...page.items], nextCursor: page.nextCursor }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div>
      <form className={styles.field} onSubmit={handleFilterSubmit} role="search">
        <label htmlFor="org-audit-action">Filtrar por acción</label>
        <input
          id="org-audit-action"
          type="text"
          value={actionInput}
          placeholder="p. ej. organization.invitation.created"
          onChange={(e) => setActionInput(e.target.value)}
        />
        <div className={styles.actions}>
          <button type="submit" className={styles.secondaryButton}>
            Filtrar
          </button>
          {action && (
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                setActionInput('');
                setAction('');
              }}
            >
              Quitar filtro
            </button>
          )}
        </div>
      </form>

      {error && <ErrorState title="No pudimos cargar la auditoría" body={error} onRetry={() => setRetryTick((tick) => tick + 1)} />}
      {!error && !state && <Skeleton rows={5} />}
      {!error && state && state.items.length === 0 && <EmptyState title="Todavía no hay actividad registrada" />}
      {!error && state && state.items.length > 0 && (
        <>
          <AuditLogTable items={state.items} />
          {state.nextCursor && (
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} disabled={loadingMore} onClick={() => void handleLoadMore()}>
                Cargar más
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
