/** Read-only detail of one inbox item (SDD-065 D1): the `body` already travels in the `InboxItemDto`, so no
 * extra request — rendered with the shared `MarkdownPreview`. */
import type { ReactElement } from 'react';
import type { InboxItemDto } from '@prdm/contracts';
import { Drawer, IdTag } from '../../components/index.js';
import { MarkdownPreview } from '../../components/MarkdownPreview.js';
import { formatReceivedDate, statusLabel } from './entrada-filters.js';
import styles from './ItemDrawer.module.css';

export interface ItemDrawerProps {
  readonly item: InboxItemDto;
  readonly onClose: () => void;
}

export function ItemDrawer({ item, onClose }: ItemDrawerProps): ReactElement {
  return (
    <Drawer open title={item.title} onClose={onClose}>
      <p className={styles.meta}>
        <IdTag id={item.id} />
        <span>{item.kind}</span>
        <span>Fuente: {item.source}</span>
        <span>Recibido: {formatReceivedDate(item.receivedAt)}</span>
        <span>{statusLabel(item.status)}</span>
      </p>
      <div className={styles.body}>
        <MarkdownPreview body={item.body} />
      </div>
    </Drawer>
  );
}
