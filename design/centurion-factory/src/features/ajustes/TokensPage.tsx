import type { ReactElement } from 'react';
import { Button, EmptyState, ErrorState, Skeleton } from '../../components';
import { useDemoState } from '../../lib/use-demo-state';
import { CreateTokenModal } from './CreateTokenModal';
import { NewTokenSecretPanel } from './NewTokenSecretPanel';
import { RevokeTokenModal } from './RevokeTokenModal';
import styles from './TokensPage.module.css';
import { TokensTable } from './TokensTable';
import { useTokensState } from './useTokensState';

/** /ajustes/tokens: CI tokens table plus create/revoke flows (WO-306). */
export function TokensPage(): ReactElement {
  const { state, retry } = useDemoState();
  const tokens = useTokensState();

  return (
    <>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionText}>
          <h2 className={styles.sectionTitle}>Tokens de CI</h2>
          <p className={styles.sectionDescription}>
            Solo un token de CI en la rama por defecto avanza el reporte oficial de drift.
          </p>
        </div>
        {state === 'listo' ? (
          <Button type="button" variant="primary" onClick={tokens.openCreate}>
            Crear token
          </Button>
        ) : null}
      </div>

      <NewTokenSecretPanel tokens={tokens} />

      {state === 'cargando' ? <Skeleton rows={3} /> : null}

      {state === 'error' ? (
        <ErrorState title="No pudimos cargar los tokens" body="Volvé a intentarlo en un momento." onRetry={retry} />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState
          title="No hay tokens de CI todavía."
          body="Creá uno para que CI pueda enviar reportes de drift."
          action={{ label: 'Crear token', onClick: tokens.openCreate }}
        />
      ) : null}

      {state === 'listo' ? (
        <div className={styles.tableSection}>
          <TokensTable tokens={tokens.tokens} onRevoke={tokens.handleRevoke} onDelete={tokens.handleDelete} />
          <p className={styles.footerNote}>Máximo 90 días. Rotalos antes de que venzan para no cortar el reporte oficial.</p>
        </div>
      ) : null}

      <CreateTokenModal
        open={tokens.createOpen}
        existingNames={tokens.tokens.map((token) => token.name)}
        onClose={tokens.closeCreate}
        onCreate={tokens.handleCreate}
      />

      <RevokeTokenModal tokens={tokens} />
    </>
  );
}
