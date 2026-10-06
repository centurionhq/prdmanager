/**
 * Pure state transitions and validation for the Órdenes de trabajo drawer (WO-292). Every
 * transition returns a new WorkOrder; none of them mutate the one they're given.
 */
import type { ActorRef, WorkOrder } from '../../data';

/**
 * The demo's signed-in session — Ana Ríos, `dev:ana` in `src/data/people.ts` — exposed as the
 * handle the «Yo» option of "Tomar orden" sends (SDD-086 §D2, FB-146). A `null` handle models a
 * session without one: the modal has to explain that instead of assigning a broken actor.
 */
export const CURRENT_HANDLE: string | null = 'ana';

/** How a person is named as an actor: `dev:<handle>`. */
export function devActor(handle: string): ActorRef {
  return `dev:${handle}`;
}

/** The charset the server accepts for an `agent:<name>` actor (SDD-086 §D2). */
const AGENT_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidAgentName(value: string): boolean {
  return AGENT_NAME_PATTERN.test(value.trim());
}

export const AGENT_NAME_ERROR = 'Escribí el nombre del agente (letras, números, punto, guion o guion bajo, hasta 64).';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

export function isValidCommitSha(value: string): boolean {
  return COMMIT_SHA_PATTERN.test(value.trim());
}

export const COMMIT_SHA_ERROR = 'Pegá el SHA del commit (7 a 40 caracteres hexadecimales).';

function nowIso(): string {
  return new Date().toISOString();
}

/** pending -> in_progress, claimed by `assignee`. */
export function takeOrder(order: WorkOrder, assignee: ActorRef): WorkOrder {
  const timestamp = nowIso();
  return { ...order, status: 'in_progress', assignedTo: assignee, claimedAt: timestamp, updatedAt: timestamp };
}

/** out_of_sync -> in_progress, keeping the existing assignee. */
export function retakeOrder(order: WorkOrder): WorkOrder {
  return { ...order, status: 'in_progress', updatedAt: nowIso() };
}

/** pending|in_progress|out_of_sync -> archived, recording when and (optionally) why. */
export function archiveOrder(order: WorkOrder, reason?: string): WorkOrder {
  const timestamp = nowIso();
  const trimmed = reason?.trim();
  return {
    ...order,
    status: 'archived',
    updatedAt: timestamp,
    archivedAt: timestamp,
    archiveReason: trimmed ? trimmed : undefined,
  };
}

/** in_progress -> done, recording the completing commit. */
export function completeOrder(order: WorkOrder, sha: string): WorkOrder {
  const timestamp = nowIso();
  return { ...order, status: 'done', completedAt: timestamp, updatedAt: timestamp, commitShas: [...order.commitShas, sha.trim()] };
}
