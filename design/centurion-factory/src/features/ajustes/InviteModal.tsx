import { useEffect, useId, useState, type ChangeEvent, type KeyboardEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { ProjectRole } from '../../data';
import { CENTURIONHQ_DOMAIN, domainOf, isValidEmail } from '../login/lib';
import styles from './MiembrosPage.module.css';
import { PROJECT_ROLES, ROLE_HINTS, ROLE_LABELS } from './permissions';

export interface InviteInput {
  readonly email: string;
  readonly role: ProjectRole;
}

export interface InviteModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onInvite: (input: InviteInput) => void;
}

const EMAIL_ERROR = 'Escribí un email válido.';
const OTHER_DOMAIN_NOTE = 'Es de otro dominio: va a entrar con contraseña.';

/** "Invitar persona" modal: email plus a role radiogroup with a hint per role (WO-305). */
export function InviteModal({ open, onClose, onInvite }: InviteModalProps): ReactElement {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('developer');
  const [error, setError] = useState<string>();
  const emailErrorId = useId();
  const roleLabelId = useId();

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('developer');
    setError(undefined);
  }, [open]);

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>): void {
    setEmail(event.target.value);
    setError(undefined);
  }

  function handleSubmit(): void {
    if (!isValidEmail(email)) {
      setError(EMAIL_ERROR);
      return;
    }
    onInvite({ email: email.trim(), role });
  }

  function handleRoleGroupKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const isNext = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const isPrev = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!isNext && !isPrev) return;
    event.preventDefault();

    const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    const currentIndex = radios.findIndex((radio) => radio === document.activeElement);
    const delta = isNext ? 1 : -1;
    const nextIndex = (currentIndex + delta + radios.length) % radios.length;
    const nextRole = PROJECT_ROLES[nextIndex];
    const nextRadio = radios[nextIndex];
    if (!nextRole || !nextRadio) return;
    setRole(nextRole);
    nextRadio.focus();
  }

  const otherDomain = isValidEmail(email) && domainOf(email) !== CENTURIONHQ_DOMAIN;

  return (
    <Modal
      open={open}
      title="Invitar persona"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit}>
            Enviar invitación
          </Button>
        </>
      }
    >
      <div className={styles.fieldGroup}>
        <label htmlFor="invite-email" className={styles.label}>
          Email
        </label>
        <input
          id="invite-email"
          type="email"
          className={styles.textInput}
          value={email}
          onChange={handleEmailChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? emailErrorId : undefined}
        />
        {error ? (
          <p id={emailErrorId} role="alert" className={styles.fieldError}>
            {error}
          </p>
        ) : null}
        {!error && otherDomain ? <p className={styles.fieldNote}>{OTHER_DOMAIN_NOTE}</p> : null}
      </div>

      <div className={styles.fieldGroup}>
        <label id={roleLabelId} className={styles.label}>
          Rol en prdmanager
        </label>
        <div
          role="radiogroup"
          aria-labelledby={roleLabelId}
          className={styles.roleSegments}
          onKeyDown={handleRoleGroupKeyDown}
        >
          {PROJECT_ROLES.map((option) => {
            const selected = option === role;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                className={[styles.roleSegment, selected ? styles.roleSegmentSelected : null].filter(Boolean).join(' ')}
                onClick={() => setRole(option)}
              >
                {ROLE_LABELS[option]}
              </button>
            );
          })}
        </div>
        <p className={styles.fieldNote}>{ROLE_HINTS[role]}</p>
      </div>

      <p className={styles.inviteNote}>Le mandamos un enlace de un solo uso que vence en 7 días.</p>
    </Modal>
  );
}
