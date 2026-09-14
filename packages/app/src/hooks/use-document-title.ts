/**
 * UI/a11y review (Phase 3 gate): every route rendered the same static `<title>prdm</title>` from
 * `index.html` regardless of navigation, so screen-reader users switching tabs/history entries and the
 * browser's own tab title never reflected which of the 11+ SPA routes was actually showing.
 */
import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} — prdm`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
