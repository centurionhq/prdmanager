/** The Tomar/Completar/Retomar workflow state and mutations for OrderDrawer. */
import { useState } from 'react';
import { useToast } from '../../components';
import type { ActorRef, WorkOrder } from '../../data';
import { completeOrder, retakeOrder, takeOrder } from './actions';

export interface UseOrderDrawerActionsResult {
  readonly takeOpen: boolean;
  readonly openTake: () => void;
  readonly closeTake: () => void;
  readonly completeOpen: boolean;
  readonly openComplete: () => void;
  readonly closeComplete: () => void;
  readonly handleTakeConfirm: (assignee: ActorRef) => void;
  readonly handleRetake: () => void;
  readonly handleCompleteConfirm: (sha: string) => void;
}

export function useOrderDrawerActions(order: WorkOrder, onUpdate: (next: WorkOrder) => void): UseOrderDrawerActionsResult {
  const { show } = useToast();
  const [takeOpen, setTakeOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);

  function handleTakeConfirm(assignee: ActorRef): void {
    onUpdate(takeOrder(order, assignee));
    setTakeOpen(false);
    show('Orden tomada', { tone: 'success' });
  }

  function handleRetake(): void {
    onUpdate(retakeOrder(order));
    show('Orden retomada', { tone: 'success' });
  }

  function handleCompleteConfirm(sha: string): void {
    onUpdate(completeOrder(order, sha));
    setCompleteOpen(false);
    show('Orden completada', { tone: 'success' });
  }

  return {
    takeOpen,
    openTake: () => setTakeOpen(true),
    closeTake: () => setTakeOpen(false),
    completeOpen,
    openComplete: () => setCompleteOpen(true),
    closeComplete: () => setCompleteOpen(false),
    handleTakeConfirm,
    handleRetake,
    handleCompleteConfirm,
  };
}
