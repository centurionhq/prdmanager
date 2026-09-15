import type { ReactElement } from 'react';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '../../components';
import { useDemoState } from '../../lib/use-demo-state';
import { EntradaAside } from './EntradaAside';
import { EntradaModals } from './EntradaModals';
import styles from './EntradaPage.module.css';
import { EntradaTabs } from './EntradaTabs';
import { useEntradaState } from './useEntradaState';

/** Bandeja de entrada: triage feedback into features, or leave it as reference (WO-295). */
export function EntradaPage(): ReactElement {
  const { state, retry } = useDemoState();
  const entrada = useEntradaState();

  return (
    <div className={styles.page}>
      <PageHeader
        title="Bandeja de entrada"
        subtitle="Feedback y artifacts que todavía no justifican una feature"
        actions={
          <Button type="button" variant="secondary" onClick={entrada.openRegister}>
            Registrar feedback
          </Button>
        }
      />

      {state === 'cargando' ? <Skeleton rows={6} /> : null}

      {state === 'error' ? (
        <ErrorState title="No pudimos cargar la bandeja" body="Algo falló al traer el feedback. Volvé a intentarlo." onRetry={retry} />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState title="Todavía no hay feedback ni artifacts" body="Lo nuevo llega desde el MCP o la CLI." />
      ) : null}

      {state === 'listo' ? (
        <div className={styles.layout}>
          <div className={styles.main}>
            <EntradaTabs state={entrada} />
          </div>
          <EntradaAside />
        </div>
      ) : null}

      <EntradaModals entrada={entrada} />
    </div>
  );
}
