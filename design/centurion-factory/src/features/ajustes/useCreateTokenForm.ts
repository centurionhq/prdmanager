/** Form state for CreateTokenModal, reset every time the modal opens. */
import { useEffect, useState, type ChangeEvent } from 'react';
import type { TokenScope } from '../../data';
import type { CreateTokenInput } from './CreateTokenModal';

const NAME_ERROR = 'Ponele un nombre al token.';
const DUPLICATE_NAME_ERROR = 'Ya existe un token con ese nombre.';

function toggleScope(scopes: readonly TokenScope[], scope: TokenScope): readonly TokenScope[] {
  return scopes.includes(scope) ? scopes.filter((entry) => entry !== scope) : [...scopes, scope];
}

export interface UseCreateTokenFormResult {
  readonly name: string;
  readonly scopes: readonly TokenScope[];
  readonly toggleScope: (scope: TokenScope) => void;
  readonly branch: string;
  readonly setBranch: (branch: string) => void;
  readonly expiresInDays: number;
  readonly setExpiresInDays: (days: number) => void;
  readonly error: string | undefined;
  readonly handleNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly handleSubmit: () => void;
}

export function useCreateTokenForm(
  open: boolean,
  existingNames: readonly string[],
  onCreate: (input: CreateTokenInput) => void,
): UseCreateTokenFormResult {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<readonly TokenScope[]>([]);
  const [branch, setBranch] = useState('main');
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName('');
    setScopes([]);
    setBranch('main');
    setExpiresInDays(30);
    setError(undefined);
  }, [open]);

  function handleNameChange(event: ChangeEvent<HTMLInputElement>): void {
    setName(event.target.value);
    setError(undefined);
  }

  function handleSubmit(): void {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError(NAME_ERROR);
      return;
    }
    const isDuplicate = existingNames.some((existing) => existing.toLowerCase() === trimmedName.toLowerCase());
    if (isDuplicate) {
      setError(DUPLICATE_NAME_ERROR);
      return;
    }
    onCreate({ name: trimmedName, scopes, branch, expiresInDays });
  }

  return {
    name,
    scopes,
    toggleScope: (scope) => setScopes((current) => toggleScope(current, scope)),
    branch,
    setBranch,
    expiresInDays,
    setExpiresInDays,
    error,
    handleNameChange,
    handleSubmit,
  };
}
