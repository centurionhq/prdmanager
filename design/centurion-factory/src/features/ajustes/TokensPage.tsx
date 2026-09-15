import { Check, Copy } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Button, EmptyState, ErrorState, Modal, Skeleton, useToast } from '../../components';
import { CI_TOKENS, type CiToken } from '../../data';
import { useDemoState } from '../../lib/use-demo-state';
import { CreateTokenModal, type CreateTokenInput } from './CreateTokenModal';
import { generateTokenSecret, toDateOnly } from './lib';
import styles from './TokensPage.module.css';
import { TokensTable } from './TokensTable';

const CURRENT_PERSON_ID = 'ana-rios';

interface NewTokenSecret {
  readonly name: string;
  readonly secret: string;
}

interface PendingRemoval {
  readonly message: string;
  readonly onConfirm: () => void;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** /ajustes/tokens: CI tokens table plus create/revoke flows (WO-306). */
export function TokensPage(): ReactElement {
  const { state, retry } = useDemoState();
  const toast = useToast();
  const [tokens, setTokens] = useState<readonly CiToken[]>(() => [...CI_TOKENS]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<NewTokenSecret | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);

  function handleCreate(input: CreateTokenInput): void {
    const { prefix, secret } = generateTokenSecret();
    const created: CiToken = {
      name: input.name,
      prefix,
      scopes: input.scopes,
      branch: input.branch,
      createdBy: CURRENT_PERSON_ID,
      createdAt: toDateOnly(new Date()),
      expiresAt: toDateOnly(daysFromNow(input.expiresInDays)),
      expired: false,
    };
    setTokens((current) => [created, ...current]);
    setCreateOpen(false);
    setNewSecret({ name: created.name, secret });
  }

  async function handleCopy(): Promise<void> {
    if (!newSecret) return;
    if (navigator.clipboard) await navigator.clipboard.writeText(newSecret.secret);
    toast.show('Token copiado');
  }

  function handleRevoke(token: CiToken): void {
    setPendingRemoval({
      message: `¿Revocar el token ${token.name}? Ya no va a poder enviar reportes de CI.`,
      onConfirm: () => {
        setTokens((current) => current.filter((entry) => entry.name !== token.name));
        toast.show('Token revocado');
        setPendingRemoval(null);
      },
    });
  }

  function handleDelete(token: CiToken): void {
    setTokens((current) => current.filter((entry) => entry.name !== token.name));
    toast.show('Token eliminado');
  }

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
          <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
            Crear token
          </Button>
        ) : null}
      </div>

      {newSecret ? (
        <div role="status" className={styles.successPanel}>
          <div className={styles.successHeader}>
            <Check aria-hidden="true" size={20} className={styles.successIcon} />
            <span className={styles.successTitle}>Token creado</span>
          </div>
          <p className={styles.successBody}>Copiá el token ahora. Por seguridad no lo vamos a volver a mostrar.</p>
          <div className={styles.successRow}>
            <input readOnly className={`id ${styles.secretField}`} value={newSecret.secret} />
            <Button type="button" variant="secondary" onClick={handleCopy}>
              <Copy aria-hidden="true" size={16} />
              Copiar
            </Button>
            <button type="button" className={styles.linkButton} onClick={() => setNewSecret(null)}>
              Ya lo guardé
            </button>
          </div>
        </div>
      ) : null}

      {state === 'cargando' ? <Skeleton rows={3} /> : null}

      {state === 'error' ? (
        <ErrorState title="No pudimos cargar los tokens" body="Volvé a intentarlo en un momento." onRetry={retry} />
      ) : null}

      {state === 'vacio' ? (
        <EmptyState
          title="No hay tokens de CI todavía."
          body="Creá uno para que CI pueda enviar reportes de drift."
          action={{ label: 'Crear token', onClick: () => setCreateOpen(true) }}
        />
      ) : null}

      {state === 'listo' ? (
        <div className={styles.tableSection}>
          <TokensTable tokens={tokens} onRevoke={handleRevoke} onDelete={handleDelete} />
          <p className={styles.footerNote}>Máximo 90 días. Rotalos antes de que venzan para no cortar el reporte oficial.</p>
        </div>
      ) : null}

      <CreateTokenModal open={createOpen} onClose={() => setCreateOpen(false)} onCreate={handleCreate} />

      <Modal
        open={pendingRemoval !== null}
        title="Revocar token"
        onClose={() => setPendingRemoval(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPendingRemoval(null)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={() => pendingRemoval?.onConfirm()}>
              Confirmar
            </Button>
          </>
        }
      >
        <p>{pendingRemoval?.message}</p>
      </Modal>
    </>
  );
}
