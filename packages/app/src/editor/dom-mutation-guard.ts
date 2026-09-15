/**
 * Undoes a batch of `MutationRecord`s directly (WO-378): every node this component renders came from React,
 * never from a browser default action or a foreign script, so any mutation reaching here was never something
 * React's own reconciliation is tracking — removing an added node (or restoring an old attribute/character
 * data value) is safe precisely because React has no reference to it either way. Requires the observer to
 * have been configured with `attributeOldValue`/`characterDataOldValue` so `record.oldValue` is populated.
 */
export function revertMutationRecords(records: readonly MutationRecord[]): void {
  for (const record of records) {
    if (record.type === 'characterData') {
      if (record.target.nodeType === Node.TEXT_NODE) (record.target as CharacterData).data = record.oldValue ?? '';
      continue;
    }

    if (record.type === 'attributes') {
      const element = record.target as Element;
      const name = record.attributeName;
      if (!name) continue;
      if (record.oldValue === null) element.removeAttribute(name);
      else element.setAttribute(name, record.oldValue);
      continue;
    }

    record.addedNodes.forEach((node) => {
      if (node.parentNode === record.target) record.target.removeChild(node);
    });
    record.removedNodes.forEach((node) => {
      if (!node.parentNode) record.target.insertBefore(node, record.nextSibling);
    });
  }
}
