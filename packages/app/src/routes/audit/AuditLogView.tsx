/**
 * The audit trail of a scope (SDD-056/PRD-036 R2): an exact-action filter, the table, and "Cargar más" keyset
 * pagination. The project's and the organisation's screens were two copies of this; they differ only in *which*
 * log they read and in the heading above it, so the body lives here once and each screen passes its own `load`.
 *
 * It manages its own `cargando`/`error`/`listo` state instead of `useApiQuery`, for the reason both originals
 * gave: that hook replaces its page wholesale on every call, with no way to *append* a further page or to drop
 * an in-flight fetch when the filter changes mid-load.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { AuditLogEntryDto } from '@prdm/contracts';
import { Button, EmptyState, ErrorState, Skeleton, TextField } from '../../components/index.js';
import { errorMessage } from '../../api/error-message.js';
import { AuditLogTable } from '../audit-log-table.js';
import styles from './AuditLogView.module.css';

export interface AuditLogPageResult {
  readonly items: AuditLogEntryDto[];
  readonly nextCursor: string | null;
}

export interface AuditLogViewProps {
  /** Reads one page of the log this screen shows. */
  readonly load: (params: { action?: string; cursor?: string }) => Promise<AuditLogPageResult>;
  /** Changes when the screen now shows a different log (another project or organisation): resets everything. */
  readonly scopeKey: string;
}

interface State {
  items: AuditLogEntryDto[];
  nextCursor: string | null;
}

export function AuditLogView({ load, scopeKey }: AuditLogViewProps): ReactElement {
  const [action, setAction] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    setAction('');
    setActionInput('');
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    loadRef
      .current({ action: action || undefined })
      .then((page) => {
        if (!cancelled) setState({ items: page.items, nextCursor: page.nextCursor });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey, action, retryTick]);

  function handleFilterSubmit(event: FormEvent): void {
    event.preventDefault();
    setAction(actionInput.trim());
  }

  async function handleLoadMore(): Promise<void> {
    if (!state?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await loadRef.current({ action: action || undefined, cursor: state.nextCursor });
      setState((prev) => ({ items: [...(prev?.items ?? []), ...page.items], nextCursor: page.nextCursor }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className={styles.view}>
      <form className={styles.filter} onSubmit={handleFilterSubmit} role="search">
        <div className={styles.filterField}>
          <TextField label="Filtrar por acción" value={actionInput} onChange={setActionInput} placeholder="p. ej. document.published" />
        </div>
        <div className={styles.filterActions}>
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {action ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setActionInput('');
                setAction('');
              }}
            >
              Quitar filtro
            </Button>
          ) : null}
        </div>
      </form>

      {error ? <ErrorState title="No pudimos cargar la auditoría" body={error} onRetry={() => setRetryTick((tick) => tick + 1)} /> : null}
      {!error && !state ? <Skeleton rows={5} /> : null}
      {!error && state && state.items.length === 0 ? <EmptyState title="Todavía no hay actividad registrada" /> : null}
      {!error && state && state.items.length > 0 ? (
        <>
          <AuditLogTable items={state.items} />
          {state.nextCursor ? (
            <div className={styles.more}>
              <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => void handleLoadMore()}>
                Cargar más
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
