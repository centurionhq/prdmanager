/**
 * The plate every 404 / "no access" screen shares (SDD-071): an optional brand mark, a title, a body, an
 * optional action link, and optional `destinations` (a `NavLink` nav that honours `end`) so the screen is
 * never a dead end.
 */
import type { ReactElement, ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
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
  readonly action?: NotFoundPanelAction;
  readonly destinations?: readonly NotFoundPanelDestination[];
}

export function NotFoundPanel({ title, body, brand, action, destinations }:NotFoundPanelProps): ReactElement {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {brand ? <span className={styles.brand}>{brand}</span> : null}
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>{body}</p>
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
