/**
 * All form state and transitions for the Login screen (WO-302): SSO email step, provider
 * redirects and the password fallback. The redirect delay itself lives in `useRedirectTimer`.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { CENTURIONHQ_DOMAIN, domainOf, isValidEmail, matchesDemoCredentials } from './lib';
import { useRedirectTimer } from './useRedirectTimer';
import type { SsoProvider } from './SsoForm';

export type LoginMode = 'sso' | 'password';

export interface UseLoginFormResult {
  readonly mode: LoginMode;
  readonly email: string;
  readonly setEmail: (email: string) => void;
  readonly validationError: string | undefined;
  readonly domainMessage: string | undefined;
  readonly redirectingProvider: SsoProvider | null;
  readonly password: string;
  readonly setPassword: (password: string) => void;
  readonly showPassword: boolean;
  readonly toggleShowPassword: () => void;
  readonly passwordError: boolean;
  readonly ssoEmailRef: RefObject<HTMLInputElement | null>;
  readonly passwordEmailRef: RefObject<HTMLInputElement | null>;
  readonly handleContinueSso: () => void;
  readonly handleContinueProvider: (provider: 'google' | 'microsoft') => void;
  readonly handleSwitchToPassword: () => void;
  readonly handleSwitchToSso: () => void;
  readonly handleSubmitPassword: () => void;
}

export function useLoginForm(onSuccess: () => void): UseLoginFormResult {
  const [mode, setMode] = useState<LoginMode>('sso');
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState<string>();
  const [domainMessage, setDomainMessage] = useState<string>();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const redirect = useRedirectTimer(onSuccess);

  const ssoEmailRef = useRef<HTMLInputElement>(null);
  const passwordEmailRef = useRef<HTMLInputElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const target = mode === 'sso' ? ssoEmailRef.current : passwordEmailRef.current;
    target?.focus();
  }, [mode]);

  function handleContinueSso(): void {
    setDomainMessage(undefined);
    if (!isValidEmail(email)) {
      setValidationError('Escribí tu email de trabajo.');
      ssoEmailRef.current?.focus();
      return;
    }
    setValidationError(undefined);
    const domain = domainOf(email);
    if (domain === CENTURIONHQ_DOMAIN) {
      redirect.startRedirect('okta');
      return;
    }
    setDomainMessage(`Tu organización no tiene SSO configurado para ${domain}. Entrá con email y contraseña o pedile acceso a tu admin.`);
  }

  function handleContinueProvider(provider: 'google' | 'microsoft'): void {
    setValidationError(undefined);
    setDomainMessage(undefined);
    redirect.startRedirect(provider);
  }

  function handleSwitchToPassword(): void {
    redirect.cancelRedirect();
    setValidationError(undefined);
    setDomainMessage(undefined);
    setMode('password');
  }

  function handleSwitchToSso(): void {
    setPasswordError(false);
    setMode('sso');
  }

  function handleSubmitPassword(): void {
    if (matchesDemoCredentials(email, password)) {
      onSuccess();
      return;
    }
    setPasswordError(true);
  }

  return {
    mode,
    email,
    setEmail,
    validationError,
    domainMessage,
    redirectingProvider: redirect.redirectingProvider,
    password,
    setPassword,
    showPassword,
    toggleShowPassword: () => setShowPassword((value) => !value),
    passwordError,
    ssoEmailRef,
    passwordEmailRef,
    handleContinueSso,
    handleContinueProvider,
    handleSwitchToPassword,
    handleSwitchToSso,
    handleSubmitPassword,
  };
}
