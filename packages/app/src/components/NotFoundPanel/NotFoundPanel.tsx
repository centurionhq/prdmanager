/**
 * The plate every 404 / "no access" screen shares (SDD-071): an optional brand mark, a title, a body, an
 * optional action link, and optional `destinations` (a `NavLink` nav that honours `end`) so the screen is
 * never a dead end.
 *
 * SDD-103 D2 extends the same plate for the render-error screens instead of growing a second one: `mark`
 * (non-chromatic eyebrow), `code` (copyable error code), `onRetry` (the one primary action) and `alert`
 * (`role="alert"` + focus on the title). All optional; the 404s pass none of them and render as before.
 */
import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Button } from '../Button/Button.js';
import { COPY_FAILED_MESSAGE, copyButtonLabel, useCopyToClipboard } from '../CopyBlock/use-copy-to-clipboard.js';
import styles from './NotFoundPanel.module.css';

export interface NotFoundPanelAction {
  readonly to: string;
  readonly label: string;
}

export interface NotFoundPanelDestination {
  readonly to: string;
  readonly label: string;
  readonly end?: boolean;
}

export interface NotFoundPanelProps {
  readonly title: string;
  readonly body: ReactNode;
  readonly brand?: string;
  readonly mark?: string;
  readonly code?: { readonly label: string; readonly value: string; readonly note: string };
  readonly onRetry?: () => void;
  readonly alert?: boolean;
  readonly action?: NotFoundPanelAction;
  readonly destinations?: readonly NotFoundPanelDestination[];
}

function ErrorCode({ label, value, note }: NonNullable<NotFoundPanelProps['code']>): ReactElement {
  const { state, copy } = useCopyToClipboard(value);

  return (
    <div role="group" aria-label={label} className={styles.code}>
      <span className={styles.codeLabel}>{label}</span>
      <div className={styles.codeRow}>
        <code className={styles.codeValue}>{value}</code>
        <button type="button" className={styles.copy} onClick={() => void copy()}>
          {copyButtonLabel(state)}
        </button>
      </div>
      <p className={styles.codeNote}>{note}</p>
      {state === 'failed' ? (
        <p role="status" className={styles.codeNote}>
          {COPY_FAILED_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}

export function NotFoundPanel({
  title,
  body,
  brand,
  mark,
  code,
  onRetry,
  alert = false,
  action,
  destinations,
}: NotFoundPanelProps): ReactElement {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (alert) titleRef.current?.focus();
  }, [alert]);

  return (
    <div className={styles.page}>
      <div className={styles.card} role={alert ? 'alert' : undefined}>
        {brand ? <span className={styles.brand}>{brand}</span> : null}
        {mark ? (
          <span className={styles.mark}>
            <span className={styles.markSquare} aria-hidden="true" />
            {mark}
          </span>
        ) : null}
        <h1 ref={titleRef} tabIndex={alert ? -1 : undefined} className={styles.title}>
          {title}
        </h1>
        <p className={styles.body}>{body}</p>
        {code ? <ErrorCode {...code} /> : null}
        {onRetry ? (
          <Button variant="primary" onClick={onRetry}>
            Reintentar
          </Button>
        ) : null}
        {action ? (
          <Link to={action.to} className={styles.action}>
            {action.label}
          </Link>
        ) : null}
        {destinations ? (
          <nav aria-label="Destinos del proyecto" className={styles.destinations}>
            <ul className={styles.destinationList}>
              {destinations.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end ?? false}
                    className={({ isActive }) => (isActive ? `${styles.destination} ${styles.active}` : styles.destination)}
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
