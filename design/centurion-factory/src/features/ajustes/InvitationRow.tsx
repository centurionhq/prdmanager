/** MembersTable's row for one pending invitation: reenviar/revocar actions. */
import { Mail } from 'lucide-react';
import type { ReactElement } from 'react';
import { getPerson, type Invitation } from '../../data';
import { formatDate } from './lib';
import styles from './MiembrosPage.module.css';
import { ROLE_LABELS } from './permissions';

export interface InvitationRowProps {
  readonly invitation: Invitation;
  readonly onResend: (invitation: Invitation) => void;
  readonly onRevoke: (invitation: Invitation) => void;
}

export function InvitationRow({ invitation, onResend, onRevoke }: InvitationRowProps): ReactElement {
  return (
    <tr className={styles.row}>
      <td className={styles.cell}>
        <div className={styles.personCell}>
          <span className={styles.avatarPending} aria-hidden="true">
            <Mail size={16} />
          </span>
          <div className={styles.personText}>
            <span className={styles.personNameRow}>
              {invitation.email}
              <span className={styles.badge}>Invitación pendiente</span>
            </span>
            <span className={styles.personEmail}>
              {`Invitado por ${getPerson(invitation.invitedBy)?.name ?? invitation.invitedBy}, vence el ${formatDate(invitation.expiresAt)}`}
            </span>
          </div>
        </div>
      </td>
      <td data-label="Rol" className={styles.cell}>
        {ROLE_LABELS[invitation.role]}
      </td>
      <td data-label="Acceso" className={styles.cell}>
        <span aria-hidden="true">—</span>
        <span className="visually-hidden">Sin acceso todavía</span>
      </td>
      <td className={`${styles.cell} ${styles.actionsCell}`}>
        <button type="button" className={styles.linkButton} onClick={() => onResend(invitation)}>
          Reenviar
        </button>
        <button type="button" className={styles.dangerLink} onClick={() => onRevoke(invitation)}>
          Revocar
        </button>
      </td>
    </tr>
  );
}
