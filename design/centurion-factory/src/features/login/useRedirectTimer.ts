/** The "Redirigiendo a…" delay before a successful SSO login navigates away. */
import { useEffect, useRef, useState } from 'react';
import type { SsoProvider } from './SsoForm';

const REDIRECT_DELAY_MS = 1200;

export interface UseRedirectTimerResult {
  readonly redirectingProvider: SsoProvider | null;
  readonly startRedirect: (provider: SsoProvider) => void;
  readonly cancelRedirect: () => void;
}

export function useRedirectTimer(onSuccess: () => void): UseRedirectTimerResult {
  const [redirectingProvider, setRedirectingProvider] = useState<SsoProvider | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
    };
  }, []);

  function startRedirect(provider: SsoProvider): void {
    setRedirectingProvider(provider);
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
    redirectTimer.current = setTimeout(onSuccess, REDIRECT_DELAY_MS);
  }

  function cancelRedirect(): void {
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
    setRedirectingProvider(null);
  }

  return { redirectingProvider, startRedirect, cancelRedirect };
}
