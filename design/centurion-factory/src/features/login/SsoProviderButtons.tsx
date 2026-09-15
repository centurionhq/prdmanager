/** SsoForm's Google/Microsoft provider buttons and their redirect status. */
import { Globe, Grid2x2, LoaderCircle } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '../../components';
import styles from './LoginPage.module.css';
import type { SsoProvider } from './SsoForm';

export interface SsoProviderButtonsProps {
  readonly redirectingProvider: SsoProvider | null;
  readonly onContinueProvider: (provider: 'google' | 'microsoft') => void;
}

function RedirectStatus({ label }: { readonly label: string }): ReactElement {
  return (
    <div role="status" className={styles.redirectStatus}>
      <LoaderCircle aria-hidden="true" size={16} className={styles.spinner} />
      {label}
    </div>
  );
}

export function SsoProviderButtons({ redirectingProvider, onContinueProvider }: SsoProviderButtonsProps): ReactElement {
  return (
    <div className={styles.providerGroup}>
      <Button type="button" variant="secondary" className={styles.fullWidth} onClick={() => onContinueProvider('google')}>
        <Globe aria-hidden="true" size={18} />
        Continuar con Google Workspace
      </Button>
      {redirectingProvider === 'google' ? <RedirectStatus label="Redirigiendo a Google Workspace…" /> : null}
      <Button type="button" variant="secondary" className={styles.fullWidth} onClick={() => onContinueProvider('microsoft')}>
        <Grid2x2 aria-hidden="true" size={18} />
        Continuar con Microsoft Entra ID
      </Button>
      {redirectingProvider === 'microsoft' ? <RedirectStatus label="Redirigiendo a Microsoft Entra ID…" /> : null}
    </div>
  );
}
