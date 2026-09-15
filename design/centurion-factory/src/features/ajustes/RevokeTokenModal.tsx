/** TokensPage's "Revocar token" confirmation modal. */
import type { ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { UseTokensStateResult } from './useTokensState';

export interface RevokeTokenModalProps {
  readonly tokens: UseTokensStateResult;
}

export function RevokeTokenModal({ tokens }: RevokeTokenModalProps): ReactElement {
  return (
    <Modal
      open={tokens.pendingRemoval !== null}
      title="Revocar token"
      onClose={tokens.cancelRemoval}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={tokens.cancelRemoval}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => tokens.pendingRemoval?.onConfirm()}>
            Confirmar
          </Button>
        </>
      }
    >
      <p>{tokens.pendingRemoval?.message}</p>
    </Modal>
  );
}
