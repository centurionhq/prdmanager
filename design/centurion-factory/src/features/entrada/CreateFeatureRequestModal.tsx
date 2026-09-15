import { useEffect, useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button, Modal } from '../../components';
import type { Feature, InboxItem } from '../../data';
import styles from './EntradaModals.module.css';
import { rankCandidates } from './lib';

export interface CreateFeatureRequestModalProps {
  readonly open: boolean;
  readonly item: InboxItem | undefined;
  readonly features: readonly Feature[];
  readonly onClose: () => void;
  readonly onConfirm: (input: { readonly title: string; readonly parentFeatureId: string }) => void;
}

/** "Crear feature request": título prefilled from the feedback, with a parent feature (WO-295). */
export function CreateFeatureRequestModal({ open, item, features, onClose, onConfirm }: CreateFeatureRequestModalProps): ReactElement | null {
  const titleId = useId();
  const parentId = useId();
  const [title, setTitle] = useState(item?.title ?? '');
  const defaultParent = (item ? rankCandidates(item)[0]?.featureId : undefined) ?? features[0]?.id ?? '';
  const [parentFeatureId, setParentFeatureId] = useState(defaultParent);

  useEffect(() => {
    setTitle(item?.title ?? '');
    setParentFeatureId((item ? rankCandidates(item)[0]?.featureId : undefined) ?? features[0]?.id ?? '');
    // Only reseed the form when a different feedback item is targeted, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  if (!item) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Crear feature request"
      description={`Desde ${item.id}`}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="primary" disabled={!title.trim()} onClick={() => onConfirm({ title: title.trim(), parentFeatureId })}>
            Crear feature request
          </Button>
        </>
      }
    >
      <div className={styles.field}>
        <label htmlFor={titleId} className={styles.label}>
          Título
        </label>
        <input id={titleId} className={styles.input} value={title} onChange={(event: ChangeEvent<HTMLInputElement>) => setTitle(event.target.value)} />
      </div>
      <div className={styles.field}>
        <label htmlFor={parentId} className={styles.label}>
          Feature madre
        </label>
        <select
          id={parentId}
          className={styles.select}
          value={parentFeatureId}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => setParentFeatureId(event.target.value)}
        >
          {features.map((feature) => (
            <option key={feature.id} value={feature.id}>
              {feature.id} · {feature.title}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
