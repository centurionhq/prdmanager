/**
 * The audit trail of a scope (SDD-056/PRD-036 R2; SDD-091 D5): the filters, the table, and "Cargar más" keyset
 * pagination. The project's and the organisation's screens were two copies of this; they differ only in *which*
 * log they read and in the heading above it, so the body lives here once and each screen passes its own `load`.
 *
 * The four filters — action, a date range, the person — live in the URL (`?accion=&desde=&hasta=&actor=`, see
 * `./filters.ts`), so reloading the page or sharing the link reproduces the cut. The action list and the people
 * come from the scope's own facets, which is why the caller passes `loadFacets` alongside `load`.
 *
 * It manages its own `cargando`/`error`/`listo` state instead of `useApiQuery`, for the reason both originals
 * gave: that hook replaces its page wholesale on every call, with no way to *append* a further page or to drop
 * an in-flight fetch when the filter changes mid-load.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import type { AuditFacetsDto, AuditLogEntryDto } from '@prdm/contracts';
import { Button, EmptyState, ErrorState, SelectField, Skeleton, TextField } from '../../components/index.js';
import type { AuditLogParams } from '../../api/audit.js';
import { errorMessage } from '../../api/error-message.js';
import { AuditLogTable } from '../audit-log-table.js';
import { actorDisplay } from './actor-display.js';
import {
  EMPTY_AUDIT_FILTERS,
  applyAuditFilters,
  formatActorValue,
  hasAuditFilters,
  parseAuditFilters,
  toAuditQuery,
  type AuditFilterState,
} from './filters.js';
import styles from './AuditLogView.module.css';

export interface AuditLogPageResult {
  readonly items: AuditLogEntryDto[];
  readonly nextCursor: string | null;
  /** Entries in the filtered cut (SDD-091); an older server sends none, and then no total is drawn. */
  readonly total?: number;
}

export interface AuditLogViewProps {
  /** Reads one page of the log this screen shows. */
  readonly load: (params: AuditLogParams) => Promise<AuditLogPageResult>;
  /** Reads the actions and people this log contains, with their counts (SDD-091 D3): it is what turns the
   * action filter into a list of the actions that exist. Optional: a screen that cannot offer it still filters
   * by an exact action, which stays as the advanced path. */
  readonly loadFacets?: () => Promise<AuditFacetsDto>;
  /** Changes when the screen now shows a different log (another project or organisation): resets everything. */
  readonly scopeKey: string;
}

interface State {
  items: AuditLogEntryDto[];
  nextCursor: string | null;
  total?: number;
}

/** The select's value for «escribir un valor exacto»: never a real action name, which is always dot-separated. */
const CUSTOM_ACTION = 'otra';
const ALL_ACTIONS = '';
const ALL_ACTORS = '';

export function AuditLogView({ load, loadFacets, scopeKey }: AuditLogViewProps): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseAuditFilters(searchParams), [searchParams]);
  const [state, setState] = useState<State | null>(null);
  const [facets, setFacets] = useState<AuditFacetsDto | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [customAction, setCustomAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const loadFacetsRef = useRef(loadFacets);
  loadFacetsRef.current = loadFacets;

  function writeFilters(next: AuditFilterState): void {
    setSearchParams(
      (previous) => {
        const updated = applyAuditFilters(previous, next);
        return updated.toString() === previous.toString() ? previous : updated;
      },
      { replace: true },
    );
  }

  function patchFilters(patch: Partial<AuditFilterState>): void {
    writeFilters({ ...filters, ...patch });
  }

  // Another project or organisation is another log: its filters go with it instead of following the user
  // around. Skipped on mount, where the URL is exactly the shared link this screen opened with.
  const shownScope = useRef(scopeKey);
  useEffect(() => {
    if (shownScope.current === scopeKey) return;
    shownScope.current = scopeKey;
    setCustomAction(false);
    setActionInput('');
    setSearchParams(
      (previous) => {
        const cleared = applyAuditFilters(previous, EMPTY_AUDIT_FILTERS);
        return cleared.toString() === previous.toString() ? previous : cleared;
      },
      { replace: true },
    );
  }, [scopeKey, setSearchParams]);

  // The filters every call carries, so the exact action typed into the advanced field follows the URL.
  useEffect(() => {
    setActionInput(filters.action);
  }, [filters.action]);

  // Facets are a convenience: if the endpoint is missing (an older server) or fails, the screen keeps working
  // with the exact-action field and no people list, instead of showing an error over a readable log.
  useEffect(() => {
    setFacets(null);
    const read = loadFacetsRef.current;
    if (!read) return;
    let cancelled = false;
    void read()
      .then((value) => {
        if (!cancelled) setFacets(value);
      })
      .catch(() => {
        if (!cancelled) setFacets(null);
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    setState(null);
    setError(null);
    loadRef
      .current(toAuditQuery(filters))
      .then((page) => {
        if (!cancelled) setState({ items: page.items, nextCursor: page.nextCursor, total: page.total });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [scopeKey, filters, retryTick]);

  function handleFilterSubmit(event: FormEvent): void {
    event.preventDefault();
    const action = actionInput.trim();
    if (action === '') setCustomAction(false);
    patchFilters({ action });
  }

  async function handleLoadMore(): Promise<void> {
    if (!state?.nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await loadRef.current({ ...toAuditQuery(filters), cursor: state.nextCursor });
      setState((prev) => ({ items: [...(prev?.items ?? []), ...page.items], nextCursor: page.nextCursor, total: page.total ?? prev?.total }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const facetActions = facets?.actions ?? [];
  const facetActors = facets?.actors ?? [];
  const actionInFacets = filters.action !== '' && facetActions.some((facet) => facet.action === filters.action);
  // A filter that is not in the list (an older server with no facets, or a hand-edited link) opens the exact
  // field pre-filled rather than showing an empty select over a filtered table.
  const exactAction = customAction || (filters.action !== '' && !actionInFacets);

  const actionOptions = [
    { value: ALL_ACTIONS, label: 'Todas las acciones' },
    ...facetActions.map((facet) => ({ value: facet.action, label: `${facet.action} (${facet.count})` })),
    { value: CUSTOM_ACTION, label: 'Otra acción…' },
  ];

  const actorInFacets = filters.actor !== '' && facetActors.some((actor) => formatActorValue(actor) === filters.actor);
  const actorOptions = [
    { value: ALL_ACTORS, label: 'Todas las personas' },
    ...facetActors.map((actor) => ({ value: formatActorValue(actor), label: `${actorDisplay(actor).text} (${actor.count})` })),
    ...(filters.actor !== '' && !actorInFacets ? [{ value: filters.actor, label: filters.actor }] : []),
  ];

  const filtered = hasAuditFilters(filters);
  const total = state?.total;

  return (
    <div className={styles.view}>
      <form className={styles.filter} onSubmit={handleFilterSubmit} role="search">
        <div className={styles.filterField}>
          <SelectField
            label="Acción"
            value={exactAction ? CUSTOM_ACTION : filters.action}
            options={actionOptions}
            onChange={(value) => {
              if (value === CUSTOM_ACTION) {
                setCustomAction(true);
                return;
              }
              setCustomAction(false);
              patchFilters({ action: value });
            }}
          />
        </div>
        {exactAction ? (
          <div className={styles.filterField}>
            <TextField label="Filtrar por acción" value={actionInput} onChange={setActionInput} placeholder="p. ej. document.published" />
          </div>
        ) : null}
        <div className={styles.filterField}>
          <TextField label="Desde" type="date" value={filters.from} max={filters.to || undefined} onChange={(value) => patchFilters({ from: value })} />
        </div>
        <div className={styles.filterField}>
          <TextField label="Hasta" type="date" value={filters.to} onChange={(value) => patchFilters({ to: value })} />
        </div>
        <div className={styles.filterField}>
          <SelectField
            label="Persona"
            value={filters.actor}
            options={actorOptions}
            onChange={(value) => patchFilters({ actor: value })}
          />
        </div>
        <div className={styles.filterActions}>
          {exactAction ? (
            <Button type="submit" variant="secondary">
              Filtrar
            </Button>
          ) : null}
          {filtered ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCustomAction(false);
                writeFilters(EMPTY_AUDIT_FILTERS);
              }}
            >
              Quitar filtros
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
          {total !== undefined || state.nextCursor ? (
            <div className={styles.more}>
              {total !== undefined ? (
                <p className={styles.total}>
                  Mostrando <span className="num">{state.items.length}</span> de <span className="num">{total}</span>
                </p>
              ) : null}
              {state.nextCursor ? (
                <Button type="button" variant="secondary" disabled={loadingMore} onClick={() => void handleLoadMore()}>
                  Cargar más
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
