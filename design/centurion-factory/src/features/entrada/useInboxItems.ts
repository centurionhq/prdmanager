/** The Bandeja de entrada item list and its mutations (link, create feature request, register). */
import { useState } from 'react';
import { FEATURES, INBOX_ITEMS, referenceNow, type InboxItem } from '../../data';
import { nextFeatureRequestId, nextFeedbackId } from './lib';
import type { RegisterFeedbackInput } from './RegisterFeedbackModal';

export interface UseInboxItemsResult {
  readonly sinTriar: readonly InboxItem[];
  readonly triados: readonly InboxItem[];
  readonly artifacts: readonly InboxItem[];
  readonly linkItem: (itemId: string, featureId: string) => void;
  /** Creates a feature request and links `itemId` to it, returning the new id. */
  readonly createFeatureRequest: (itemId: string) => string;
  readonly registerFeedback: (input: RegisterFeedbackInput) => void;
}

export function useInboxItems(): UseInboxItemsResult {
  const [items, setItems] = useState<readonly InboxItem[]>(INBOX_ITEMS);
  const [createdFeatureIds, setCreatedFeatureIds] = useState<readonly string[]>([]);
  const feedback = items.filter((item) => item.kind === 'FB');

  function linkItem(itemId: string, featureId: string): void {
    setItems((previous) => previous.map((item) => (item.id === itemId ? { ...item, status: 'triaged', links: [featureId] } : item)));
  }

  function createFeatureRequest(itemId: string): string {
    const featureRequestId = nextFeatureRequestId([...FEATURES.map((feature) => feature.id), ...createdFeatureIds]);
    setCreatedFeatureIds((previous) => [...previous, featureRequestId]);
    linkItem(itemId, featureRequestId);
    return featureRequestId;
  }

  function registerFeedback(input: RegisterFeedbackInput): void {
    const newItem: InboxItem = {
      id: nextFeedbackId(items),
      kind: 'FB',
      title: input.title,
      body: input.body,
      source: input.source,
      status: 'new',
      links: [],
      receivedAt: referenceNow().toISOString(),
      candidates: [],
      sample: true,
    };
    setItems((previous) => [newItem, ...previous]);
  }

  return {
    sinTriar: feedback.filter((item) => item.status === 'new'),
    triados: feedback.filter((item) => item.status === 'triaged'),
    artifacts: items.filter((item) => item.kind === 'ART'),
    linkItem,
    createFeatureRequest,
    registerFeedback,
  };
}
