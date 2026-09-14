/**
 * Frontmatter form bound directly to the live `Y.Map('fm')` (SDD-008 §"Editor"): no save button — every
 * change writes straight to `fm`, the same live-collab model the body editor uses. Never renders (or
 * writes) a server-managed field (`id`/`type`/`status`/`closed_*`/...): those come from the document's
 * real Postgres columns and are shown elsewhere in the page chrome as read-only, not here.
 */
import { useEffect, useState, type ChangeEvent, type FocusEvent, type ReactElement } from 'react';
import type * as Y from 'yjs';
import type { DocKind } from '@prdm/core/domain';
import type { FrontmatterValue } from '@prdm/collab';
import { frontmatterFieldsForKind, validateFrontmatterFields, type FrontmatterValidationIssue } from '../collab/frontmatter-fields.js';
import { useCollabDocumentContext } from '../collab/collab-document-context.js';
import styles from '../styles/frontmatter-form.module.css';

export interface FrontmatterFormProps {
  kind: DocKind;
}

function readFmSnapshot(fm: Y.Map<FrontmatterValue>): Record<string, FrontmatterValue> {
  const snapshot: Record<string, FrontmatterValue> = {};
  fm.forEach((value, key) => {
    snapshot[key] = value;
  });
  return snapshot;
}

function toDisplayString(value: FrontmatterValue | undefined): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function fromListInput(raw: string): string[] {
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function FrontmatterForm({ kind }: FrontmatterFormProps): ReactElement | null {
  const { provider, state } = useCollabDocumentContext();
  const fields = frontmatterFieldsForKind(kind);
  const [values, setValues] = useState<Record<string, FrontmatterValue>>({});
  // Raw text for `id-list`/`string-list` fields only, separate from `values`: re-deriving a comma-joined
  // display string from the just-written array on every keystroke fights the user typing the very comma
  // that's supposed to separate entries (each keystroke would immediately re-normalize away a trailing
  // "," before the next character lands). These fields commit to the Y.Map on blur instead — still no
  // save button, just a natural point to canonicalize "a, b" from whatever the user was typing.
  const [listDrafts, setListDrafts] = useState<Record<string, string>>({});
  const readOnly = state.scope === 'readonly';

  useEffect(() => {
    if (!provider) return;
    const fm = provider.document.getMap<FrontmatterValue>('fm');
    const sync = () => {
      const snapshot = readFmSnapshot(fm);
      setValues(snapshot);
      setListDrafts(Object.fromEntries(fields.filter((f) => f.widget === 'id-list' || f.widget === 'string-list').map((f) => [f.key, toDisplayString(snapshot[f.key])])));
    };
    sync();
    fm.observe(sync);
    return () => fm.unobserve(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  if (fields.length === 0) return null;

  const issues: FrontmatterValidationIssue[] = validateFrontmatterFields(kind, values);
  const issueByField = new Map(issues.map((i) => [i.field, i.message]));

  function writeField(key: string, value: FrontmatterValue): void {
    if (!provider || readOnly) return;
    provider.document.getMap<FrontmatterValue>('fm').set(key, value);
  }

  function handleTextChange(key: string) {
    return (event: ChangeEvent<HTMLInputElement>) => writeField(key, event.target.value);
  }

  function handleListDraftChange(key: string) {
    return (event: ChangeEvent<HTMLInputElement>) => setListDrafts((prev) => ({ ...prev, [key]: event.target.value }));
  }

  function handleListCommit(key: string) {
    return (event: FocusEvent<HTMLInputElement>) => writeField(key, fromListInput(event.target.value));
  }

  function handleBooleanChange(key: string) {
    return (event: ChangeEvent<HTMLInputElement>) => writeField(key, event.target.checked);
  }

  return (
    <fieldset className={styles.form}>
      <legend className={styles.legend}>Frontmatter</legend>
      {fields.map((field) => {
        const message = issueByField.get(field.key);
        const inputId = `fm-${field.key}`;
        const isList = field.widget === 'id-list' || field.widget === 'string-list';
        return (
          <div className={styles.field} key={field.key}>
            <label htmlFor={inputId} className={styles.label}>
              {field.label}
            </label>
            {field.widget === 'boolean' ? (
              <input id={inputId} type="checkbox" disabled={readOnly} checked={Boolean(values[field.key])} onChange={handleBooleanChange(field.key)} />
            ) : isList ? (
              <input
                id={inputId}
                type="text"
                className={styles.input}
                disabled={readOnly}
                value={listDrafts[field.key] ?? ''}
                onChange={handleListDraftChange(field.key)}
                onBlur={handleListCommit(field.key)}
              />
            ) : (
              <input id={inputId} type="text" className={styles.input} disabled={readOnly} value={toDisplayString(values[field.key])} onChange={handleTextChange(field.key)} />
            )}
            {field.hint && <p className={styles.hint}>{field.hint}</p>}
            {message && (
              <p className={styles.error} role="alert">
                {message}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
