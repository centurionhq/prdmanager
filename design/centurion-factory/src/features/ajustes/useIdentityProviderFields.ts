/** Identity-provider fields (protocol, OIDC/SAML details) for the SSO settings form. */
import { useState, type ChangeEvent } from 'react';
import { SSO_SETTINGS } from '../../data';

export type SsoProtocol = 'oidc' | 'saml';
export type WithDirty = <A extends unknown[]>(action: (...args: A) => void) => (...args: A) => void;

export interface UseIdentityProviderFieldsResult {
  readonly protocol: SsoProtocol;
  readonly provider: string;
  readonly metadataUrl: string;
  readonly entityId: string;
  readonly certificateUploaded: boolean;
  readonly secretRevealed: boolean;
  readonly handleProtocolChange: (next: SsoProtocol) => void;
  readonly handleProviderChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly handleMetadataUrlChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleEntityIdChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleUploadCertificate: () => void;
  readonly handleReplaceSecret: () => void;
  readonly handleSecretInputChange: () => void;
}

export function useIdentityProviderFields(withDirty: WithDirty): UseIdentityProviderFieldsResult {
  const [protocol, setProtocol] = useState<SsoProtocol>(SSO_SETTINGS.protocol);
  const [provider, setProvider] = useState(SSO_SETTINGS.provider);
  const [metadataUrl, setMetadataUrl] = useState('');
  const [entityId, setEntityId] = useState('');
  const [certificateUploaded, setCertificateUploaded] = useState(false);
  const [secretRevealed, setSecretRevealed] = useState(false);

  return {
    protocol,
    provider,
    metadataUrl,
    entityId,
    certificateUploaded,
    secretRevealed,
    handleProtocolChange: withDirty((next: SsoProtocol) => setProtocol(next)),
    handleProviderChange: withDirty((event: ChangeEvent<HTMLSelectElement>) => setProvider(event.target.value)),
    handleMetadataUrlChange: withDirty((event: ChangeEvent<HTMLInputElement>) => setMetadataUrl(event.target.value)),
    handleEntityIdChange: withDirty((event: ChangeEvent<HTMLInputElement>) => setEntityId(event.target.value)),
    handleUploadCertificate: withDirty(() => setCertificateUploaded(true)),
    handleReplaceSecret: withDirty(() => setSecretRevealed(true)),
    handleSecretInputChange: withDirty(() => undefined),
  };
}
