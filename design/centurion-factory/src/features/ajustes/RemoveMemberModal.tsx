/** MiembrosPage's "Quitar persona" confirmation modal. */
import type { ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { UseMiembrosStateResult } from './useMiembrosState';

export interface RemoveMemberModalProps {
  readonly state: UseMiembrosStateResult;
}

export function RemoveMemberModal({ state }: RemoveMemberModalProps): ReactElement {
  return (
    <Modal
      open={state.pendingRemoval !== null}
      title="Quitar persona"
      onClose={state.cancelRemoval}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={state.cancelRemoval}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => state.pendingRemoval?.onConfirm()}>
            Confirmar
          </Button>
        </>
      }
    >
      <p>{state.pendingRemoval?.message}</p>
    </Modal>
  );
}
