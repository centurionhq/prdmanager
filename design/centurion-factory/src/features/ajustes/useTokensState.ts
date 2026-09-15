/** Token list state and the create/copy/revoke/delete mutations for TokensPage (WO-306). */
import { useRef, useState, type RefObject } from 'react';
import { useToast } from '../../components';
import { CI_TOKENS, type CiToken } from '../../data';
import type { CreateTokenInput } from './CreateTokenModal';
import { CLIPBOARD_ERROR, copyToClipboard, generateTokenSecret, toDateOnly } from './lib';

const CURRENT_PERSON_ID = 'ana-rios';

interface NewTokenSecret {
  readonly name: string;
  readonly secret: string;
}

interface PendingRemoval {
  readonly message: string;
  readonly onConfirm: () => void;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export interface UseTokensStateResult {
  readonly tokens: readonly CiToken[];
  readonly createOpen: boolean;
  readonly openCreate: () => void;
  readonly closeCreate: () => void;
  readonly newSecret: NewTokenSecret | null;
  readonly dismissNewSecret: () => void;
  readonly secretFieldRef: RefObject<HTMLInputElement | null>;
  readonly pendingRemoval: PendingRemoval | null;
  readonly cancelRemoval: () => void;
  readonly handleCreate: (input: CreateTokenInput) => void;
  readonly handleCopy: () => Promise<void>;
  readonly handleRevoke: (token: CiToken) => void;
  readonly handleDelete: (token: CiToken) => void;
}

export function useTokensState(): UseTokensStateResult {
  const toast = useToast();
  const [tokens, setTokens] = useState<readonly CiToken[]>(() => [...CI_TOKENS]);
  const [createOpen, setCreateOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<NewTokenSecret | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval | null>(null);
  const secretFieldRef = useRef<HTMLInputElement>(null);

  function handleCreate(input: CreateTokenInput): void {
    const { prefix, secret } = generateTokenSecret();
    const created: CiToken = {
      name: input.name,
      prefix,
      scopes: input.scopes,
      branch: input.branch,
      createdBy: CURRENT_PERSON_ID,
      createdAt: toDateOnly(new Date()),
      expiresAt: toDateOnly(daysFromNow(input.expiresInDays)),
      expired: false,
    };
    setTokens((current) => [created, ...current]);
    setCreateOpen(false);
    setNewSecret({ name: created.name, secret });
  }

  async function handleCopy(): Promise<void> {
    if (!newSecret) return;
    const copied = await copyToClipboard(newSecret.secret);
    if (copied) {
      toast.show('Token copiado');
      return;
    }
    secretFieldRef.current?.select();
    toast.show(CLIPBOARD_ERROR);
  }

  function handleRevoke(token: CiToken): void {
    setPendingRemoval({
      message: `¿Revocar el token ${token.name}? Ya no va a poder enviar reportes de CI.`,
      onConfirm: () => {
        setTokens((current) => current.filter((entry) => entry.prefix !== token.prefix));
        toast.show('Token revocado');
        setPendingRemoval(null);
      },
    });
  }

  function handleDelete(token: CiToken): void {
    setTokens((current) => current.filter((entry) => entry.prefix !== token.prefix));
    toast.show('Token eliminado');
  }

  return {
    tokens,
    createOpen,
    openCreate: () => setCreateOpen(true),
    closeCreate: () => setCreateOpen(false),
    newSecret,
    dismissNewSecret: () => setNewSecret(null),
    secretFieldRef,
    pendingRemoval,
    cancelRemoval: () => setPendingRemoval(null),
    handleCreate,
    handleCopy,
    handleRevoke,
    handleDelete,
  };
}
