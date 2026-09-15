/**
 * DOM helpers for the preview editor's inline formatting (WO-313): toggling Negrita/Cursiva/
 * Tachado off unwraps the tag instead of nesting a second one, and every formatting operation
 * normalizes the result — merging adjacent identical tags, dropping any left empty.
 */
const MERGEABLE_TAGS = new Set(['STRONG', 'EM', 'DEL']);

/** The closest ancestor of `node` (up to and including `root`) with the given `tagName`, if any. */
export function findAncestorWithTag(node: Node | null, root: HTMLElement, tagName: string): HTMLElement | null {
  let current: Node | null = node;
  while (current && current !== root.parentNode) {
    if (current.nodeType === 1 /* ELEMENT_NODE */ && (current as HTMLElement).tagName === tagName) return current as HTMLElement;
    if (current === root) break;
    current = current.parentNode;
  }
  return null;
}

/** Replaces `element` with its own children, moved in place, then removes the now-empty wrapper. */
export function unwrapElement(element: HTMLElement): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

/** Merges `element` with a same-tag sibling right next to it, recursively, until none are left. */
function mergeAdjacentSiblings(element: HTMLElement): void {
  const next = element.nextSibling;
  if (next && next.nodeType === 1 && (next as HTMLElement).tagName === element.tagName && MERGEABLE_TAGS.has(element.tagName)) {
    while (next.firstChild) element.appendChild(next.firstChild);
    next.parentNode?.removeChild(next);
    mergeAdjacentSiblings(element);
  }
}

/** Drops empty `<strong>/<em>/<del>` elements and merges adjacent ones with the same tag. */
export function normalizeFormatting(root: HTMLElement): void {
  Array.from(root.querySelectorAll<HTMLElement>('strong, em, del')).forEach((element) => {
    if (!element.isConnected) return;
    if (!element.textContent) {
      element.remove();
      return;
    }
    normalizeFormatting(element);
    mergeAdjacentSiblings(element);
  });
}
