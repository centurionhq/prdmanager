/** SsoPage's "Probar conexión" section: a test-login button and its resulting status message. */
import { Check } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '../../components';
import styles from './SsoPage.module.css';
import type { UseSsoSettingsFormResult } from './useSsoSettingsForm';

export interface TestConnectionSectionProps {
  readonly form: UseSsoSettingsFormResult;
}

export function TestConnectionSection({ form }: TestConnectionSectionProps): ReactElement {
  return (
    <div className={styles.sectionRow}>
      <div className={styles.sectionLabel}>
        <h3 className={styles.sectionLabelTitle}>Probar conexión</h3>
        <p className={styles.sectionLabelBody}>Hacé un ingreso de prueba con tu cuenta.</p>
      </div>
      <div className={styles.testRow}>
        <Button type="button" variant="secondary" onClick={form.handleTestConnection}>
          Probar conexión
        </Button>
        {form.tested ? (
          <div role="status" className={styles.testStatus}>
            <Check aria-hidden="true" size={16} className={styles.testIcon} />
            <span>{`Conexión correcta. Okta devolvió ana.rios@centurionhq.com con los grupos cf-admins y cf-producto.`}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
