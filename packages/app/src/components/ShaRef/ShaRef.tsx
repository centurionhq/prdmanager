/**
 * WO-635 (SDD-069): a commit sha as something you can act on — short enough to read, copyable in one click,
 * and linked to its commit on GitHub only when the project knows which repository it lives in. The link is
 * never guessed: with no repository the sha degrades to copy-only, instead of pointing somewhere that does
 * not exist. The copy itself is the shared `useCopyToClipboard` (same behaviour, same failure copy as
 * `CopyBlock`), and the button is the design system's `Button`, so it keeps the standard hit target.
 */
import type { ReactElement } from 'react';
import { COPY_FAILED_MESSAGE, copyButtonLabel, useCopyToClipboard } from '../CopyBlock/use-copy-to-clipboard.js';
import { Button } from '../Button/Button.js';
import styles from './ShaRef.module.css';

export interface ShaRefProps {
  /** The full sha; what is shown is a truncation of it, but what is copied and linked is always the whole. */
  readonly sha: string;
  /** `owner/repo`, as `project.settings.github_repository` holds it. `null` or blank means no link. */
  readonly repository?: string | null;
}

/** Same truncation the drift screens used before this component existed: 12 characters. */
const SHORT_SHA_LENGTH = 12;

export function ShaRef({ sha, repository }: ShaRefProps): ReactElement {
  const { state, copy } = useCopyToClipboard(sha);
  const repo = repository?.trim();
  // The visible label is short, so the button is named after the action *and* the sha: that is what tells a
  // screen reader which commit is about to land in the clipboard. Once copied, the name carries the
  // confirmation too — an `aria-label` overrides the visible text, so keeping the action name would hide the
  // outcome from assistive tech.
  const name = state === 'copied' ? `Sha ${sha} copiado` : `Copiar el sha ${sha}`;

  return (
    <span className={styles.ref}>
      <span className="id" title={sha}>
        {sha.slice(0, SHORT_SHA_LENGTH)}
      </span>
      <Button variant="secondary" size="sm" aria-label={name} onClick={() => void copy()}>
        {copyButtonLabel(state)}
      </Button>
      {repo ? (
        <a
          className={styles.link}
          href={`https://github.com/${repo}/commit/${sha}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver el commit en GitHub
        </a>
      ) : null}
      {state === 'failed' ? (
        <span role="status" className={styles.failed}>
          {COPY_FAILED_MESSAGE}
        </span>
      ) : null}
    </span>
  );
}
