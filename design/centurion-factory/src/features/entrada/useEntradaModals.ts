/** Open/closed state and target item for EntradaPage's three modals. */
import { useState } from 'react';
import type { InboxItem } from '../../data';

export interface UseEntradaModalsResult {
  readonly registerOpen: boolean;
  readonly openRegister: () => void;
  readonly closeRegister: () => void;
  readonly linkTarget: InboxItem | undefined;
  readonly linkOpen: boolean;
  readonly openLink: (item: InboxItem) => void;
  readonly closeLink: () => void;
  readonly createTarget: InboxItem | undefined;
  readonly createOpen: boolean;
  readonly openCreate: (item: InboxItem) => void;
  readonly closeCreate: () => void;
}

export function useEntradaModals(): UseEntradaModalsResult {
  const [registerOpen, setRegisterOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<InboxItem | undefined>(undefined);
  const [linkOpen, setLinkOpen] = useState(false);
  const [createTarget, setCreateTarget] = useState<InboxItem | undefined>(undefined);
  const [createOpen, setCreateOpen] = useState(false);

  return {
    registerOpen,
    openRegister: () => setRegisterOpen(true),
    closeRegister: () => setRegisterOpen(false),
    linkTarget,
    linkOpen,
    openLink: (item) => {
      setLinkTarget(item);
      setLinkOpen(true);
    },
    closeLink: () => setLinkOpen(false),
    createTarget,
    createOpen,
    openCreate: (item) => {
      setCreateTarget(item);
      setCreateOpen(true);
    },
    closeCreate: () => setCreateOpen(false),
  };
}
