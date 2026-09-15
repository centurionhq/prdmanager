import type { ReactElement } from 'react';
import { Button, useToast } from '../../components';
import { SSO_SETTINGS } from '../../data';
import { AccessRulesSection } from './AccessRulesSection';
import { DomainsTable } from './DomainsTable';
import { IdentityProviderSection } from './IdentityProviderSection';
import styles from './SsoPage.module.css';
import { TestConnectionSection } from './TestConnectionSection';
import { useSsoSettingsForm } from './useSsoSettingsForm';

/** /ajustes/sso: identity provider, verified domains, access rules and a connection test (WO-307). */
export function SsoPage(): ReactElement {
  const toast = useToast();
  const form = useSsoSettingsForm(toast.show);

  return (
    <div className={styles.page}>
      <div className={styles.sectionText}>
        <h2 className={styles.sectionTitle}>Autenticación y SSO</h2>
        <p className={styles.sectionDescription}>
          Cómo entra la gente de Centurion HQ. Aplica a todos los proyectos de la organización.
        </p>
      </div>

      <div className={styles.sections}>
        <IdentityProviderSection form={form} />

        <div className={styles.sectionRow}>
          <div className={styles.sectionLabel}>
            <h3 className={styles.sectionLabelTitle}>Dominios verificados</h3>
            <p className={styles.sectionLabelBody}>Solo pueden entrar por SSO los emails de estos dominios.</p>
          </div>
          <DomainsTable
            domains={SSO_SETTINGS.domains}
            expandedDomain={form.expandedDomain}
            onToggleExpand={form.handleToggleExpand}
            onVerify={form.handleVerifyDomain}
          />
        </div>

        <AccessRulesSection form={form} />
        <TestConnectionSection form={form} />
      </div>

      <div className={styles.footerBar}>
        <span className={styles.footerText}>
          Aplica a los 5 proyectos de Centurion HQ desde el próximo ingreso.
          {form.dirty ? <span className={styles.dirtyHint}> Cambios sin guardar</span> : null}
        </span>
        <Button type="button" variant="primary" disabled={!form.dirty} onClick={form.handleSave}>
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
