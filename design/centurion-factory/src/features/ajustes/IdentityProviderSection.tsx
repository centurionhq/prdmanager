/** SsoPage's "Proveedor de identidad" section: the SAML/OIDC segmented control and its fields. */
import type { ReactElement } from 'react';
import { Button } from '../../components';
import { SSO_SETTINGS } from '../../data';
import styles from './SsoPage.module.css';
import type { UseSsoSettingsFormResult } from './useSsoSettingsForm';

function segmentClassName(selected: boolean): string {
  return [styles.segment, selected ? styles.segmentSelected : null].filter(Boolean).join(' ');
}

export interface IdentityProviderSectionProps {
  readonly form: UseSsoSettingsFormResult;
}

function OidcFields({ form }: IdentityProviderSectionProps): ReactElement {
  return (
    <>
      <div className={styles.fieldGroup}>
        <label htmlFor="sso-provider" className={styles.label}>
          Proveedor
        </label>
        <select id="sso-provider" className={styles.textInput} value={form.provider} onChange={form.handleProviderChange}>
          <option value="Okta">Okta</option>
          <option value="Google Workspace">Google Workspace</option>
          <option value="Microsoft Entra ID">Microsoft Entra ID</option>
          <option value="Otro">Otro</option>
        </select>
      </div>
      <div className={styles.fieldGroup}>
        <span className={styles.label}>Issuer URL</span>
        <div className={styles.readonlyField}>
          <span className="id">{SSO_SETTINGS.issuerUrl}</span>
        </div>
      </div>
      <div className={styles.fieldGroup}>
        <span className={styles.label}>Client ID</span>
        <div className={styles.readonlyField}>
          <span className="id">{SSO_SETTINGS.clientId}</span>
        </div>
      </div>
      <div className={styles.fieldGroup}>
        <span className={styles.label}>Client secret</span>
        <div className={styles.readonlyField}>
          {form.secretRevealed ? (
            <input className={styles.secretInput} placeholder="Pegá el nuevo secreto" onChange={form.handleSecretInputChange} />
          ) : (
            <span className={styles.secretMask}>••••••••••••</span>
          )}
          <button type="button" className={styles.linkButton} onClick={form.handleReplaceSecret}>
            Reemplazar
          </button>
        </div>
      </div>
    </>
  );
}

function SamlFields({ form }: IdentityProviderSectionProps): ReactElement {
  return (
    <>
      <div className={styles.fieldGroup}>
        <label htmlFor="saml-metadata" className={styles.label}>
          Metadata URL
        </label>
        <input id="saml-metadata" className={styles.textInput} value={form.metadataUrl} onChange={form.handleMetadataUrlChange} />
      </div>
      <div className={styles.fieldGroup}>
        <label htmlFor="saml-entity" className={styles.label}>
          Entity ID
        </label>
        <input id="saml-entity" className={styles.textInput} value={form.entityId} onChange={form.handleEntityIdChange} />
      </div>
      <div className={styles.fieldGroup}>
        <span className={styles.label}>Certificado</span>
        {form.certificateUploaded ? (
          <span className="id">certificado.pem</span>
        ) : (
          <Button type="button" variant="secondary" onClick={form.handleUploadCertificate}>
            Subí el certificado X.509
          </Button>
        )}
      </div>
    </>
  );
}

export function IdentityProviderSection({ form }: IdentityProviderSectionProps): ReactElement {
  return (
    <div className={styles.sectionRow}>
      <div className={styles.sectionLabel}>
        <h3 className={styles.sectionLabelTitle}>Proveedor de identidad</h3>
        <p className={styles.sectionLabelBody}>La gente entra con su cuenta de {form.provider}.</p>
        <div role="radiogroup" aria-label="Protocolo" className={styles.segmentGroup}>
          <button
            type="button"
            role="radio"
            aria-checked={form.protocol === 'saml'}
            className={segmentClassName(form.protocol === 'saml')}
            onClick={() => form.handleProtocolChange('saml')}
          >
            SAML 2.0
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={form.protocol === 'oidc'}
            className={segmentClassName(form.protocol === 'oidc')}
            onClick={() => form.handleProtocolChange('oidc')}
          >
            OIDC
          </button>
        </div>
      </div>

      <div className={styles.fieldsGrid}>{form.protocol === 'oidc' ? <OidcFields form={form} /> : <SamlFields form={form} />}</div>
    </div>
  );
}
