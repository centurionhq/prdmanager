/**
 * "Cerrar feature" action on `DocumentDetail` (SDD-007 "Documentos y flujo": "Cierre de feature: admin
 * de proyecto con confirmación explícita"; WO-143): a two-step confirmation — opening it fetches
 * `closureReadiness` so the admin reviews every check *before* confirming, and the confirm button stays
 * disabled unless it is actually ready. Closing a `collab`-origin Feature only ever queues the status
 * flip (WO-139's placeholder) rather than applying it immediately, which the success message says
 * explicitly rather than implying an instant visible change.
 */
import { useState, type ReactElement } from 'react';
import type { ClosureReadiness } from '@prdm/core';
import { closeFeature, getClosureReadiness } from '../api/client.js';
import { errorMessage } from '../api/error-message.js';
import { FormError } from '../components/FormError.js';
import formStyles from '../styles/forms.module.css';

export function CloseFeatureAction({ orgSlug, projectSlug, docId, onClosed }: { orgSlug: string; projectSlug: string; docId: string; onClosed: () => void }): ReactElement {
  const [readiness, setReadiness] = useState<ClosureReadiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  async function handleOpen(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      setReadiness(await getClosureReadiness(orgSlug, projectSlug, docId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await closeFeature(orgSlug, projectSlug, docId);
      setClosed(true);
      setReadiness(null);
      onClosed();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (closed) {
    return <p className={formStyles.success}>Feature cerrada. El cambio de estado quedará pendiente hasta que exista el editor colaborativo (SDD-008).</p>;
  }

  if (!readiness) {
    return (
      <button type="button" className={formStyles.secondaryButton} disabled={busy} onClick={() => void handleOpen()}>
        Cerrar feature
      </button>
    );
  }

  return (
    <div className={formStyles.card} role="dialog" aria-label="Confirmar cierre de feature">
      <h3 className={formStyles.title}>Confirmar cierre de {docId}</h3>
      <ul>
        {readiness.checks.map((check) => (
          <li key={check.name}>
            {check.ok ? '✓' : '✗'} {check.detail}
          </li>
        ))}
      </ul>
      <FormError message={error} />
      <div className={formStyles.actions}>
        <button type="button" className={formStyles.secondaryButton} disabled={busy} onClick={() => setReadiness(null)}>
          Cancelar
        </button>
        <button type="button" className={formStyles.primaryButton} disabled={busy || !readiness.ready} onClick={() => void handleConfirm()}>
          Confirmar cierre
        </button>
      </div>
    </div>
  );
}
