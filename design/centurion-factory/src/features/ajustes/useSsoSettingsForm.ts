/**
 * Local form state for the SSO settings page (WO-307): identity provider fields, access rules, the
 * connection test and a "dirty" flag for the footer's Guardar button. Extracted from SsoPage
 * (WO-319) so that component stays a thin composition of section components; identity-provider
 * fields live in `useIdentityProviderFields`.
 */
import { useState, type ChangeEvent } from 'react';
import { SSO_SETTINGS, type OrgRole } from '../../data';
import { useIdentityProviderFields, type UseIdentityProviderFieldsResult } from './useIdentityProviderFields';

export type { SsoProtocol } from './useIdentityProviderFields';

export type UseSsoSettingsFormResult = UseIdentityProviderFieldsResult & {
  readonly enforceSso: boolean;
  readonly jitProvisioning: boolean;
  readonly defaultOrgRole: OrgRole;
  readonly emergencyPasswordAccess: boolean;
  readonly expandedDomain: string | null;
  readonly tested: boolean;
  readonly dirty: boolean;
  readonly handleToggleEnforce: () => void;
  readonly handleToggleJit: () => void;
  readonly handleToggleEmergency: () => void;
  readonly handleDefaultRoleChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly handleToggleExpand: (domain: string) => void;
  readonly handleVerifyDomain: () => void;
  readonly handleTestConnection: () => void;
  readonly handleSave: () => void;
};

export function useSsoSettingsForm(showToast: (message: string) => void): UseSsoSettingsFormResult {
  const [dirty, setDirty] = useState(false);

  function withDirty<A extends unknown[]>(action: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      action(...args);
      setDirty(true);
    };
  }

  const identity = useIdentityProviderFields(withDirty);

  const [enforceSso, setEnforceSso] = useState(SSO_SETTINGS.enforceSso);
  const [jitProvisioning, setJitProvisioning] = useState(SSO_SETTINGS.jitProvisioning);
  const [defaultOrgRole, setDefaultOrgRole] = useState<OrgRole>(SSO_SETTINGS.defaultOrgRole);
  const [emergencyPasswordAccess, setEmergencyPasswordAccess] = useState(SSO_SETTINGS.emergencyPasswordAccess);

  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [tested, setTested] = useState(false);

  function handleToggleExpand(domain: string): void {
    setExpandedDomain((current) => (current === domain ? null : domain));
  }

  return {
    ...identity,
    enforceSso,
    jitProvisioning,
    defaultOrgRole,
    emergencyPasswordAccess,
    expandedDomain,
    tested,
    dirty,
    handleToggleEnforce: withDirty(() => setEnforceSso((value) => !value)),
    handleToggleJit: withDirty(() => setJitProvisioning((value) => !value)),
    handleToggleEmergency: withDirty(() => setEmergencyPasswordAccess((value) => !value)),
    handleDefaultRoleChange: withDirty((event: ChangeEvent<HTMLSelectElement>) => setDefaultOrgRole(event.target.value as OrgRole)),
    handleToggleExpand,
    handleVerifyDomain: () => showToast('Todavía no encontramos el registro TXT. Puede tardar hasta una hora.'),
    handleTestConnection: () => setTested(true),
    handleSave: () => {
      showToast('Guardado');
      setDirty(false);
    },
  };
}
