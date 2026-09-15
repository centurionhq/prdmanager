/**
 * SSO settings (WO-272), exactly as canvas/AjustesSSO.dc.html: Okta over OIDC, one verified
 * domain (centurionhq.com) and one pending (centurion.dev).
 */
import type { SsoSettings } from './types';

export const SSO_SETTINGS: SsoSettings = {
  protocol: 'oidc',
  provider: 'Okta',
  issuerUrl: 'https://centurionhq.okta.com',
  clientId: '0oa8f2c1d4kq7Zm3x697',
  domains: [
    { domain: 'centurionhq.com', verified: true, since: '2026-03-02' },
    { domain: 'centurion.dev', verified: false, txtRecord: 'prdm-verify=4f1c9e' },
  ],
  enforceSso: true,
  jitProvisioning: true,
  defaultOrgRole: 'member',
  emergencyPasswordAccess: false,
};
