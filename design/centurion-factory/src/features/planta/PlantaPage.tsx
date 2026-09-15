import { useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState, ErrorState, PageHeader, SearchField, Skeleton } from '../../components';
import { useDemoState } from '../../lib/use-demo-state';
import { LineBoard } from './LineBoard';
import { LinkButton } from './LinkButton';
import { PlantaKpiStrip } from './PlantaKpiStrip';
import { PlantaOverview } from './PlantaOverview';
import styles from './PlantaPage.module.css';

/** The Planta screen (WO-282): the line board, KPI strip and the drift/orders overview. */
export function PlantaPage(): ReactElement {
  const { state, retry } = useDemoState();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    navigate(`/documentos?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title="Planta"
        subtitle={
          <>
            Actualizado hace 4 min desde el reporte oficial de <span className="id">main</span>
          </>
        }
        actions={
          <>
            <form role="search" className={styles.searchForm} onSubmit={handleSearchSubmit}>
              <SearchField
                label="Buscar documentos, órdenes o código"
                placeholder="Buscar documentos, órdenes o código"
                value={query}
                onChange={setQuery}
              />
            </form>
            <LinkButton to="/documentos?nuevo=1" variant="primary">
              Nuevo documento
            </LinkButton>
          </>
        }
      />

      {state === 'cargando' ? (
        <div className={styles.body}>
          <Skeleton rows={6} />
          <Skeleton rows={1} columns={4} />
        </div>
      ) : null}

      {state === 'vacio' ? (
        <EmptyState
          title="Todavía no hay features en la línea."
          action={{ label: 'Crear un documento', onClick: () => navigate('/documentos?nuevo=1') }}
        />
      ) : null}

      {state === 'error' ? (
        <ErrorState
          title="No pudimos leer el reporte oficial de main."
          body="Reintentá o revisá que el token de CI siga vigente."
          onRetry={retry}
        />
      ) : null}

      {state === 'listo' ? (
        <div className={styles.body}>
          <LineBoard />
          <PlantaKpiStrip />
          <PlantaOverview />
        </div>
      ) : null}
    </div>
  );
}
