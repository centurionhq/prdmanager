import type { ReactElement } from 'react';
import { Button, EmptyState, ErrorState, PageHeader, SearchField, Skeleton } from '../../components';
import { useDemoState } from '../../lib/use-demo-state';
import { NewProjectModal } from './NewProjectModal';
import styles from './ProyectosPage.module.css';
import { ProyectosTable } from './ProyectosTable';
import { TopBar } from './TopBar';
import { useProyectosState } from './useProyectosState';

/** /proyectos, outside the project shell. See canvas/Proyectos.dc.html (WO-303). */
export function ProyectosPage(): ReactElement {
  const { state, retry } = useDemoState();
  const proyectos = useProyectosState();

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#contenido-proyectos">
        Saltar al contenido
      </a>
      <TopBar />
      <main id="contenido-proyectos" tabIndex={-1} className={styles.main}>
        <PageHeader
          title="Proyectos"
          subtitle={`${proyectos.projects.length} ${proyectos.projects.length === 1 ? 'proyecto' : 'proyectos'} en Centurion HQ`}
          actions={
            state === 'listo' ? (
              <>
                <div className={styles.searchWrap}>
                  <SearchField label="Buscar proyectos" value={proyectos.query} onChange={proyectos.setQuery} placeholder="Buscar proyectos" />
                </div>
                <Button type="button" variant="primary" onClick={proyectos.openModal}>
                  Nuevo proyecto
                </Button>
              </>
            ) : null
          }
        />

        {state === 'cargando' ? <Skeleton rows={5} /> : null}

        {state === 'error' ? (
          <ErrorState title="No pudimos cargar los proyectos" body="Volvé a intentarlo en un momento." onRetry={retry} />
        ) : null}

        {state === 'vacio' ? (
          <EmptyState
            title="Todavía no hay proyectos"
            body="Creá el primero para tu organización."
            action={{ label: 'Nuevo proyecto', onClick: proyectos.openModal }}
          />
        ) : null}

        {state === 'listo' ? <ProyectosTable state={proyectos} /> : null}
      </main>

      <NewProjectModal open={proyectos.modalOpen} onClose={proyectos.closeModal} onCreate={proyectos.handleCreateProject} />
    </div>
  );
}
