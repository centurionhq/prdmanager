import { useDeferredValue, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from 'react';
import type { SearchHit } from '@prdm/core';
import { search } from '../api/client';
import { useSelection } from '../state/selection';
import styles from './SearchBar.module.css';

/**
 * `components/SearchBar.tsx` (SDD-005 "Frontend"): `useDeferredValue` debounces the query against `/api/search`
 * (react.dev's own recommended pattern for search-as-you-type, per the react stack guideline this repo checked
 * against ui-ux-pro-max) — no `setTimeout` bookkeeping to get wrong. Results focus the chosen node via the shared
 * selection state; `/` from anywhere in the app focuses this field (wired in `App.tsx`).
 */
export function SearchBar({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }): ReactElement {
  const { select } = useSelection();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = deferredQuery.trim();
    if (trimmed.length === 0) {
      setResults([]);
      return;
    }
    const id = ++requestId.current;
    search({ q: trimmed, limit: 8 })
      .then((hits) => {
        if (requestId.current === id) {
          setResults(hits);
          setActiveIndex(0);
        }
      })
      .catch(() => {
        if (requestId.current === id) setResults([]);
      });
  }, [deferredQuery]);

  function choose(hit: SearchHit): void {
    select(hit.id);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = results[activeIndex];
      if (hit) choose(hit);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const showResults = open && query.trim().length > 0;

  return (
    <div className={styles.wrap}>
      <label className={styles.field} htmlFor="prdm-search-input">
        <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <input
          id="prdm-search-input"
          ref={inputRef}
          className={styles.input}
          type="search"
          role="combobox"
          aria-expanded={showResults}
          aria-controls={listboxId}
          aria-autocomplete="list"
          placeholder="Buscar documentos, work orders, rutas…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
        />
        <span className={styles.kbd}>/</span>
      </label>
      {showResults && (
        <ul id={listboxId} role="listbox" className={styles.results} aria-label="Resultados de búsqueda">
          {results.length === 0 ? (
            <li className={styles.empty}>Sin resultados</li>
          ) : (
            results.map((hit, index) => (
              <li
                key={hit.id}
                role="option"
                aria-selected={index === activeIndex}
                className={styles.result}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(hit)}
              >
                <span className={styles.resultId}>{hit.id}</span>
                <span className={styles.resultTitle}>{hit.title}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
