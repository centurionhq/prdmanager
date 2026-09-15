/**
 * Live revocation for the agent SSE stream (WO-253/WO-258, security review #5): mirrors
 * `../collab/revocation.ts`'s `CollabRevocationHub` exactly, but for `.../agent/messages` instead of
 * `/collab`. That hub only ever walks Hocuspocus's own connection registry, so a revoked session's
 * agent turn — which can run for several minutes (WO-227's `disableRequestTimeout`) and only ever
 * re-checks role/membership per tool call, never session validity — kept running under the revoked
 * session's authority the whole time. This hub gives `documents-agent.ts` a place to register the one
 * `AbortController` an active stream already creates for client-disconnect, so revocation reuses that
 * exact, already-tested abort path instead of inventing a second shutdown mechanism.
 *
 * Built once in `build-server.ts`, before `buildAuth` (same ordering as `collabRevocationHub`) so its
 * `databaseHooks.session.delete.after` hook can call `revokeUser` the instant a session row is deleted.
 */
export interface AgentStreamRevocationHub {
  /** Called once, right after the SSE route creates the turn's `AbortController` — before any tool runs. */
  register(userId: string, controller: AbortController): void;
  /** Called in the route's `finally`, once the turn ends (success, error, or abort) — never leaves a
   * stale controller registered for a stream that's already finished. */
  unregister(userId: string, controller: AbortController): void;
  /** Aborts every stream currently registered for this user (there is at most one at a time — SDD-009
   * "una transmisión activa por usuario" — but this tolerates more without assuming it). */
  revokeUser(userId: string): void;
}

export function createAgentStreamRevocationHub(): AgentStreamRevocationHub {
  const controllersByUser = new Map<string, Set<AbortController>>();

  return {
    register(userId, controller) {
      let controllers = controllersByUser.get(userId);
      if (!controllers) {
        controllers = new Set();
        controllersByUser.set(userId, controllers);
      }
      controllers.add(controller);
    },
    unregister(userId, controller) {
      const controllers = controllersByUser.get(userId);
      if (!controllers) return;
      controllers.delete(controller);
      if (controllers.size === 0) controllersByUser.delete(userId);
    },
    revokeUser(userId) {
      const controllers = controllersByUser.get(userId);
      if (!controllers) return;
      for (const controller of controllers) controller.abort();
    },
  };
}
