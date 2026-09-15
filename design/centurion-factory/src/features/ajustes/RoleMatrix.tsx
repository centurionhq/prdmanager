import { Check, Minus } from 'lucide-react';
import type { ReactElement } from 'react';
import { PERMISSION_LABELS, PERMISSIONS_ORDER, PROJECT_ROLES, ROLE_LABELS, hasPermission } from './permissions';
import styles from './MiembrosPage.module.css';

/** "Qué puede hacer cada rol" matrix, built from the permissions map (WO-305). */
export function RoleMatrix(): ReactElement {
  return (
    <table className={styles.matrixTable}>
      <caption className="visually-hidden">Qué puede hacer cada rol</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.matrixCorner} />
          {PROJECT_ROLES.map((role) => (
            <th key={role} scope="col" className={styles.matrixColumnHeader}>
              {ROLE_LABELS[role]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {PERMISSIONS_ORDER.map((permission) => (
          <tr key={permission}>
            <th scope="row" className={styles.matrixRowHeader}>
              {PERMISSION_LABELS[permission]}
            </th>
            {PROJECT_ROLES.map((role) => {
              const allowed = hasPermission(role, permission);
              return (
                <td key={role} className={styles.matrixCell}>
                  {allowed ? (
                    <Check aria-hidden="true" size={16} className={styles.matrixYes} />
                  ) : (
                    <Minus aria-hidden="true" size={16} className={styles.matrixNo} />
                  )}
                  <span className="visually-hidden">{allowed ? 'Sí' : 'No'}</span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
