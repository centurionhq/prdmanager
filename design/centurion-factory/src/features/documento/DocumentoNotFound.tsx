/** DocumentoPage's not-found state: no document matches the `:id` in the URL. */
import type { ReactElement } from 'react';
import { ErrorState } from '../../components';

export interface DocumentoNotFoundProps {
  readonly id: string;
  readonly onRetry: () => void;
}

export function DocumentoNotFound({ id, onRetry }: DocumentoNotFoundProps): ReactElement {
  const title = `No encontramos el documento ${id}.`;
  return (
    <>
      {/* ErrorState renders `title` as a <p>; the page still needs its own h1 (WO-313). */}
      <h1 className="visually-hidden">{title}</h1>
      <ErrorState title={title} body="Puede que se haya archivado o que el enlace esté roto." onRetry={onRetry} retryLabel="Volver a Documentos" />
    </>
  );
}
