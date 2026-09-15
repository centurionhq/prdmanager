import { FileText, Hash, Mail, MessageCircle, MessageSquare, Phone, Users } from 'lucide-react';
import type { ReactElement } from 'react';
import type { InboxItem } from '../../data';

const ICONS: Record<InboxItem['source'], typeof Users> = {
  meeting: Users,
  email: Mail,
  slack: Hash,
  call: Phone,
  doc: FileText,
  chat: MessageCircle,
  other: MessageSquare,
};

const SOURCE_LABELS: Record<InboxItem['source'], string> = {
  meeting: 'Reunión',
  email: 'Email',
  slack: 'Slack',
  call: 'Llamada',
  doc: 'Documento',
  chat: 'Chat',
  other: 'Otro',
};

export function sourceLabel(source: InboxItem['source']): string {
  return SOURCE_LABELS[source];
}

/** The small outline icon that identifies where a feedback or artifact came from. */
export function SourceIcon({ source }: { readonly source: InboxItem['source'] }): ReactElement {
  const Icon = ICONS[source];
  return <Icon aria-hidden="true" size={16} />;
}
