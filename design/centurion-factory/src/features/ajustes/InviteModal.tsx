import { useId, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { ProjectRole } from '../../data';
import styles from './MiembrosPage.module.css';
import { RoleRadioGroup } from './RoleRadioGroup';
import { useInviteForm } from './useInviteForm';

export interface InviteInput {
  readonly email: string;
  readonly role: ProjectRole;
}

export interface InviteModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onInvite: (input: InviteInput) => void;
}

const OTHER_DOMAIN_NOTE = 'Es de otro dominio: va a entrar con contraseña.';

/** "Invitar persona" modal: email plus a role radiogroup with a hint per role (WO-305). */
export function InviteModal({ open, onClose, onInvite }: InviteModalProps): ReactElement {
  const form = useInviteForm(open, onInvite);
  const emailErrorId = useId();

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
          <Button type="button" variant="primary" onClick={form.handleSubmit}>
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
          value={form.email}
          onChange={form.handleEmailChange}
          aria-invalid={form.error ? true : undefined}
          aria-describedby={form.error ? emailErrorId : undefined}
        />
        {form.error ? (
          <p id={emailErrorId} role="alert" className={styles.fieldError}>
            {form.error}
          </p>
        ) : null}
        {!form.error && form.otherDomain ? <p className={styles.fieldNote}>{OTHER_DOMAIN_NOTE}</p> : null}
      </div>

      <RoleRadioGroup role={form.role} onChange={form.setRole} />

      <p className={styles.inviteNote}>Le mandamos un enlace de un solo uso que vence en 7 días.</p>
    </Modal>
  );
}
