/** Email/role form state for InviteModal, reset every time the modal opens. */
import { useEffect, useState, type ChangeEvent } from 'react';
import type { ProjectRole } from '../../data';
import { CENTURIONHQ_DOMAIN, domainOf, isValidEmail } from '../login/lib';
import type { InviteInput } from './InviteModal';

const EMAIL_ERROR = 'Escribí un email válido.';

export interface UseInviteFormResult {
  readonly email: string;
  readonly role: ProjectRole;
  readonly setRole: (role: ProjectRole) => void;
  readonly error: string | undefined;
  readonly otherDomain: boolean;
  readonly handleEmailChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleSubmit: () => void;
}

export function useInviteForm(open: boolean, onInvite: (input: InviteInput) => void): UseInviteFormResult {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectRole>('developer');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('developer');
    setError(undefined);
  }, [open]);

  function handleEmailChange(event: ChangeEvent<HTMLInputElement>): void {
    setEmail(event.target.value);
    setError(undefined);
  }

  function handleSubmit(): void {
    if (!isValidEmail(email)) {
      setError(EMAIL_ERROR);
      return;
    }
    onInvite({ email: email.trim(), role });
  }

  const otherDomain = isValidEmail(email) && domainOf(email) !== CENTURIONHQ_DOMAIN;

  return { email, role, setRole, error, otherDomain, handleEmailChange, handleSubmit };
}
