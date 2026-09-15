/**
 * `/collab`'s own isolation probe table entry (SDD-008 §"Servidor de tiempo real", WO-146/WO-147) — a
 * separate module from `./base-routes.js` per that file's own extension-point note: a later WO imports
 * `./registry.js` directly instead of editing `base-routes.ts`.
 *
 * `GET /collab` is a WebSocket upgrade, not an ordinary JSON route: `./run-probe.js`'s `app.inject()`
 * harness can't drive a real Hocuspocus handshake (`documentName`, `onAuthenticate`) the way it drives a
 * `:param`-substituted HTTP request, so the generic `crossOrg`/`sameOrgOtherProject` probe shape doesn't
 * apply here. WO-147 covers the actual cross-org/cross-project `documentName` rejections with a dedicated
 * test using a real `HocuspocusProvider` client (`./collab-document-name.test.ts`) instead.
 */
import { registerIsolationProbe } from './registry.js';

export function registerCollabIsolationProbes(): void {
  registerIsolationProbe('GET', '/collab', {
    skip: 'WebSocket upgrade route: app.inject() cannot drive a real Hocuspocus handshake (documentName, onAuthenticate); WO-147 covers cross-org/cross-project documentName rejection with a dedicated real-client test (./collab-document-name.test.ts)',
  });
}
