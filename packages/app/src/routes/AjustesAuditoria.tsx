/**
 * `/o/:orgSlug/p/:projectSlug/ajustes/auditoria` (SDD-013 §"Shell y router"): the project's own
 * redacted audit trail (WO-342's `getProjectAuditLog`), with an exact-action filter and "Cargar más"
 * keyset pagination (WO-365).
 *
 * Deliberately manages its own `cargando`/`error`/`listo` state instead of `useApiQuery` — that hook
 * (SDD-013 §"Capa de datos") always replaces its cached page wholesale on every call, with no way to
 * *append* a further page or reset itself an in-flight fetch when the action filter changes mid-load.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import type { AuditLogEntryDto } from '@prdm/contracts';
import { EmptyState, ErrorState, Skeleton } from '../components/index.js';
import { getProjectAuditLog } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { useDocumentTitle } from '../hooks/use-document-title.js';
import { useProjectShellContext } from './ProjectShell.js';
import { AuditLogTable } from './audit-log-table.js';
import styles from '../styles/forms.module.css';

interface State {
  items: AuditLogEntryDto[];
  nextCursor: string | null;
}

export function AjustesAuditoria(): ReactElement {
  const { orgSlug, projectSlug } = useProjectShellContext();
  const [action, setAction] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  useDocumentTitle('Ajustes · auditoría');

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    getProjectAuditLog(orgSlug, projectSlug, { action: action || undefined })
      .then((page) => {
        if (!cancelled) setState({ items: page.items, nextCursor: page.nextCursor });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [orgSlug, projectSlug, action, retryTick]);

  function handleFilterSubmit(event: FormEvent): void {
    event.preventDefault();
    setAction(actionInput.trim());
  }

  async function handleLoadMore(): Promise<void> {
    if (!state?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await getProjectAuditLog(orgSlug, projectSlug, { action: action || undefined, cursor: state.nextCursor });
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
        <label htmlFor="project-audit-action">Filtrar por acción</label>
        <input
          id="project-audit-action"
          type="text"
          value={actionInput}
          placeholder="p. ej. document.published"
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
