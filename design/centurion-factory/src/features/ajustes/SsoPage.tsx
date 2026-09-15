import { Check } from 'lucide-react';
import { useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, useToast } from '../../components';
import { SSO_SETTINGS, type OrgRole } from '../../data';
import { DomainsTable } from './DomainsTable';
import styles from './SsoPage.module.css';
import { Switch } from './Switch';

type Protocol = 'oidc' | 'saml';

const ORG_ROLE_LABELS: Readonly<Record<OrgRole, string>> = { owner: 'Owner', admin: 'Admin', member: 'Member' };
const ORG_ROLES: readonly OrgRole[] = ['member', 'admin', 'owner'];

function segmentClassName(selected: boolean): string {
  return [styles.segment, selected ? styles.segmentSelected : null].filter(Boolean).join(' ');
}

/** /ajustes/sso: identity provider, verified domains, access rules and a connection test (WO-307). */
export function SsoPage(): ReactElement {
  const toast = useToast();

  const [protocol, setProtocol] = useState<Protocol>(SSO_SETTINGS.protocol);
  const [provider, setProvider] = useState(SSO_SETTINGS.provider);
  const [metadataUrl, setMetadataUrl] = useState('');
  const [entityId, setEntityId] = useState('');
  const [certificateUploaded, setCertificateUploaded] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);

  const [enforceSso, setEnforceSso] = useState(SSO_SETTINGS.enforceSso);
  const [jitProvisioning, setJitProvisioning] = useState(SSO_SETTINGS.jitProvisioning);
  const [defaultOrgRole, setDefaultOrgRole] = useState<OrgRole>(SSO_SETTINGS.defaultOrgRole);
  const [emergencyPasswordAccess, setEmergencyPasswordAccess] = useState(SSO_SETTINGS.emergencyPasswordAccess);

  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [tested, setTested] = useState(false);
  const [dirty, setDirty] = useState(false);

  function withDirty<A extends unknown[]>(action: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      action(...args);
      setDirty(true);
    };
  }

  const handleProtocolChange = withDirty((next: Protocol) => setProtocol(next));
  const handleProviderChange = withDirty((event: ChangeEvent<HTMLSelectElement>) => setProvider(event.target.value));
  const handleMetadataUrlChange = withDirty((event: ChangeEvent<HTMLInputElement>) => setMetadataUrl(event.target.value));
  const handleEntityIdChange = withDirty((event: ChangeEvent<HTMLInputElement>) => setEntityId(event.target.value));
  const handleUploadCertificate = withDirty(() => setCertificateUploaded(true));
  const handleReplaceSecret = withDirty(() => setSecretRevealed(true));
  const handleToggleEnforce = withDirty(() => setEnforceSso((value) => !value));
  const handleToggleJit = withDirty(() => setJitProvisioning((value) => !value));
  const handleToggleEmergency = withDirty(() => setEmergencyPasswordAccess((value) => !value));
  const handleDefaultRoleChange = withDirty((event: ChangeEvent<HTMLSelectElement>) =>
    setDefaultOrgRole(event.target.value as OrgRole),
  );

  function handleToggleExpand(domain: string): void {
    setExpandedDomain((current) => (current === domain ? null : domain));
  }

  function handleVerifyDomain(): void {
    toast.show('Todavía no encontramos el registro TXT. Puede tardar hasta una hora.');
  }

  function handleTestConnection(): void {
    setTested(true);
  }

  function handleSave(): void {
    toast.show('Guardado');
    setDirty(false);
  }

  return (
    <div className={styles.page}>
      <div className={styles.sectionText}>
        <h2 className={styles.sectionTitle}>Autenticación y SSO</h2>
        <p className={styles.sectionDescription}>
          Cómo entra la gente de Centurion HQ. Aplica a todos los proyectos de la organización.
        </p>
      </div>

      <div className={styles.sections}>
        <div className={styles.sectionRow}>
          <div className={styles.sectionLabel}>
            <h3 className={styles.sectionLabelTitle}>Proveedor de identidad</h3>
            <p className={styles.sectionLabelBody}>La gente entra con su cuenta de {provider}.</p>
            <div role="radiogroup" aria-label="Protocolo" className={styles.segmentGroup}>
              <button
                type="button"
                role="radio"
                aria-checked={protocol === 'saml'}
                className={segmentClassName(protocol === 'saml')}
                onClick={() => handleProtocolChange('saml')}
              >
                SAML 2.0
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={protocol === 'oidc'}
                className={segmentClassName(protocol === 'oidc')}
                onClick={() => handleProtocolChange('oidc')}
              >
                OIDC
              </button>
            </div>
          </div>

          <div className={styles.fieldsGrid}>
            {protocol === 'oidc' ? (
              <>
                <div className={styles.fieldGroup}>
                  <label htmlFor="sso-provider" className={styles.label}>
                    Proveedor
                  </label>
                  <select id="sso-provider" className={styles.textInput} value={provider} onChange={handleProviderChange}>
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
                    {secretRevealed ? (
                      <input className={styles.secretInput} placeholder="Pegá el nuevo secreto" onChange={() => setDirty(true)} />
                    ) : (
                      <span className={styles.secretMask}>••••••••••••</span>
                    )}
                    <button type="button" className={styles.linkButton} onClick={handleReplaceSecret}>
                      Reemplazar
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={styles.fieldGroup}>
                  <label htmlFor="saml-metadata" className={styles.label}>
                    Metadata URL
                  </label>
                  <input id="saml-metadata" className={styles.textInput} value={metadataUrl} onChange={handleMetadataUrlChange} />
                </div>
                <div className={styles.fieldGroup}>
                  <label htmlFor="saml-entity" className={styles.label}>
                    Entity ID
                  </label>
                  <input id="saml-entity" className={styles.textInput} value={entityId} onChange={handleEntityIdChange} />
                </div>
                <div className={styles.fieldGroup}>
                  <span className={styles.label}>Certificado</span>
                  {certificateUploaded ? (
                    <span className="id">certificado.pem</span>
                  ) : (
                    <Button type="button" variant="secondary" onClick={handleUploadCertificate}>
                      Subí el certificado X.509
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.sectionRow}>
          <div className={styles.sectionLabel}>
            <h3 className={styles.sectionLabelTitle}>Dominios verificados</h3>
            <p className={styles.sectionLabelBody}>Solo pueden entrar por SSO los emails de estos dominios.</p>
          </div>
          <DomainsTable
            domains={SSO_SETTINGS.domains}
            expandedDomain={expandedDomain}
            onToggleExpand={handleToggleExpand}
            onVerify={handleVerifyDomain}
          />
        </div>

        <div className={styles.sectionRow}>
          <div className={styles.sectionLabel}>
            <h3 className={styles.sectionLabelTitle}>Reglas de acceso</h3>
            <p className={styles.sectionLabelBody}>Aplican al próximo ingreso de cada persona.</p>
          </div>
          <div className={styles.rulesList}>
            <Switch label="Exigir SSO para todos los miembros" checked={enforceSso} onChange={handleToggleEnforce} />
            <div className={styles.ruleWithDetail}>
              <Switch
                label="Crear cuentas automáticamente al primer ingreso (JIT)"
                checked={jitProvisioning}
                onChange={handleToggleJit}
              />
              {jitProvisioning ? (
                <div className={styles.jitRoleRow}>
                  <span>Rol por defecto en la organización</span>
                  <select
                    aria-label="Rol por defecto en la organización"
                    className={styles.roleSelect}
                    value={defaultOrgRole}
                    onChange={handleDefaultRoleChange}
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
              checked={emergencyPasswordAccess}
              onChange={handleToggleEmergency}
            />
          </div>
        </div>

        <div className={styles.sectionRow}>
          <div className={styles.sectionLabel}>
            <h3 className={styles.sectionLabelTitle}>Probar conexión</h3>
            <p className={styles.sectionLabelBody}>Hacé un ingreso de prueba con tu cuenta.</p>
          </div>
          <div className={styles.testRow}>
            <Button type="button" variant="secondary" onClick={handleTestConnection}>
              Probar conexión
            </Button>
            {tested ? (
              <div role="status" className={styles.testStatus}>
                <Check aria-hidden="true" size={16} className={styles.testIcon} />
                <span>
                  {`Conexión correcta. Okta devolvió ana.rios@centurionhq.com con los grupos cf-admins y cf-producto.`}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.footerBar}>
        <span className={styles.footerText}>
          Aplica a los 5 proyectos de Centurion HQ desde el próximo ingreso.
          {dirty ? <span className={styles.dirtyHint}> Cambios sin guardar</span> : null}
        </span>
        <Button type="button" variant="primary" disabled={!dirty} onClick={handleSave}>
          Guardar cambios
        </Button>
      </div>
    </div>
  );
}
