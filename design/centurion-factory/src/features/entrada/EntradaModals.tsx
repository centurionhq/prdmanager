/** EntradaPage's three modals: registrar feedback, enlazar a feature and crear feature request. */
import type { ReactElement } from 'react';
import { FEATURES } from '../../data';
import { CreateFeatureRequestModal } from './CreateFeatureRequestModal';
import { LinkFeatureModal } from './LinkFeatureModal';
import { RegisterFeedbackModal } from './RegisterFeedbackModal';
import type { UseEntradaStateResult } from './useEntradaState';

export interface EntradaModalsProps {
  readonly entrada: UseEntradaStateResult;
}

export function EntradaModals({ entrada }: EntradaModalsProps): ReactElement {
  return (
    <>
      <RegisterFeedbackModal open={entrada.registerOpen} onClose={entrada.closeRegister} onConfirm={entrada.handleRegisterConfirm} />
      <LinkFeatureModal open={entrada.linkOpen} item={entrada.linkTarget} onClose={entrada.closeLink} onConfirm={entrada.handleLinkConfirm} />
      <CreateFeatureRequestModal
        open={entrada.createOpen}
        item={entrada.createTarget}
        features={FEATURES}
        onClose={entrada.closeCreate}
        onConfirm={entrada.handleCreateConfirm}
      />
    </>
  );
}
