/**
 * Local state and mutations for the Bandeja de entrada screen (WO-295): triage feedback into
 * features or leave it as reference. Extracted from EntradaPage (WO-319) so that component stays a
 * thin wiring layer over this hook and the tab panels; the item list lives in `useInboxItems` and
 * the modal open/target state lives in `useEntradaModals`.
 */
import { useState } from 'react';
import { useToast } from '../../components';
import type { RegisterFeedbackInput } from './RegisterFeedbackModal';
import { useEntradaModals, type UseEntradaModalsResult } from './useEntradaModals';
import { useInboxItems, type UseInboxItemsResult } from './useInboxItems';

export type TabKey = 'sin-triar' | 'triados' | 'artifacts';

export type UseEntradaStateResult = UseInboxItemsResult &
  UseEntradaModalsResult & {
    readonly tab: TabKey;
    readonly setTab: (tab: TabKey) => void;
    readonly expandedIds: ReadonlySet<string>;
    readonly toggleExpand: (id: string) => void;
    readonly handleLinkConfirm: (featureId: string) => void;
    readonly handleCreateConfirm: (input: { readonly title: string; readonly parentFeatureId: string }) => void;
    readonly handleRegisterConfirm: (input: RegisterFeedbackInput) => void;
  };

export function useEntradaState(): UseEntradaStateResult {
  const { show } = useToast();
  const inbox = useInboxItems();
  const modals = useEntradaModals();
  const [tab, setTab] = useState<TabKey>('sin-triar');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  function toggleExpand(id: string): void {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleLinkConfirm(featureId: string): void {
    if (!modals.linkTarget) return;
    inbox.linkItem(modals.linkTarget.id, featureId);
    modals.closeLink();
    show(`Feedback enlazado a ${featureId}`, { tone: 'success' });
  }

  function handleCreateConfirm(): void {
    if (!modals.createTarget) return;
    const featureRequestId = inbox.createFeatureRequest(modals.createTarget.id);
    modals.closeCreate();
    show(`Feature request ${featureRequestId} creada`, { tone: 'success' });
  }

  function handleRegisterConfirm(input: RegisterFeedbackInput): void {
    inbox.registerFeedback(input);
    modals.closeRegister();
    show('Feedback registrado', { tone: 'success' });
  }

  return { ...inbox, ...modals, tab, setTab, expandedIds, toggleExpand, handleLinkConfirm, handleCreateConfirm, handleRegisterConfirm };
}
