/** SsoPage's "Reglas de acceso" section: enforce SSO, JIT provisioning and emergency password access. */
import type { ReactElement } from 'react';
import { type OrgRole } from '../../data';
import styles from './SsoPage.module.css';
import { Switch } from './Switch';
import type { UseSsoSettingsFormResult } from './useSsoSettingsForm';

const ORG_ROLE_LABELS: Readonly<Record<OrgRole, string>> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const ORG_ROLES: readonly OrgRole[] = ['member', 'admin', 'owner'];

export interface AccessRulesSectionProps {
  readonly form: UseSsoSettingsFormResult;
}

export function AccessRulesSection({ form }: AccessRulesSectionProps): ReactElement {
  return (
    <div className={styles.sectionRow}>
      <div className={styles.sectionLabel}>
        <h3 className={styles.sectionLabelTitle}>Reglas de acceso</h3>
        <p className={styles.sectionLabelBody}>Aplican al próximo ingreso de cada persona.</p>
      </div>
      <div className={styles.rulesList}>
        <Switch label="Exigir SSO para todos los miembros" checked={form.enforceSso} onChange={form.handleToggleEnforce} />
        <div className={styles.ruleWithDetail}>
          <Switch
            label="Crear cuentas automáticamente al primer ingreso (JIT)"
            checked={form.jitProvisioning}
            onChange={form.handleToggleJit}
          />
          {form.jitProvisioning ? (
            <div className={styles.jitRoleRow}>
              <span>Rol por defecto en la organización</span>
              <select
                aria-label="Rol por defecto en la organización"
                className={styles.roleSelect}
                value={form.defaultOrgRole}
                onChange={form.handleDefaultRoleChange}
              >
                {ORG_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ORG_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <Switch
          label="Permitir email y contraseña para admins de emergencia"
          checked={form.emergencyPasswordAccess}
          onChange={form.handleToggleEmergency}
        />
      </div>
    </div>
  );
}
