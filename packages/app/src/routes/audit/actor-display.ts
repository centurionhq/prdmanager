/**
 * WO-695 (SDD-088 D4): how the audit table's «Quién» cell names an actor. The server resolves `name`; without it
 * (an older DTO, a deleted actor) the cell keeps the `tipo:id` pair it always showed, which is also the tooltip.
 */
export interface AuditActor {
  readonly type: string;
  readonly id: string;
  readonly name?: string | null;
}

export function actorDisplay(actor: AuditActor): { text: string; title: string } {
  const title = `${actor.type}:${actor.id}`;
  if (!actor.name) return { text: title, title };
  return { text: actor.type === 'user' ? actor.name : `${actor.name} (${actor.type})`, title };
}
