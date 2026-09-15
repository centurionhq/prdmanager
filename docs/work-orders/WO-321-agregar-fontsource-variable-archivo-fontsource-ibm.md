---
id: "WO-321"
type: "WO"
title: "Agregar `@fontsource-variable/archivo`, `@fontsource/ibm-plex-mono` y `lucide-react` con las mismas versiones exactas de ADR-007, `resolve.dedupe: [\"yjs\"]` en `vite.config.ts`, portar `tokens.css` y `base.css` desde `design/centurion-factory`, actualizar `main.tsx` (jitless primero, sin importar los"
status: "done"
created_at: "2026-09-15"
implements: ["ADR-008"]
impacts_paths: ["packages/app/package.json","packages/app/vite.config.ts","packages/app/index.htm[l]","packages/app/src/main.tsx","packages/app/src/styles/**","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "91b902ea7a77e026"
tags: ["architecture-decision","design","frontend","saas"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:01:59.593Z"
completed_at: "2026-09-15T21:29:19.460Z"
resolved_by: ["06eb456a1829cac045c1a737b5c83052fd297f87"]
blueprint_hashes: {"ADR-008":"1f07b3185476edfb48331daed34fe8636722e66c1c28dacebd89041b95f6657e"}
---

## Objetivo
Agregar `@fontsource-variable/archivo`, `@fontsource/ibm-plex-mono` y `lucide-react` con las mismas versiones exactas de ADR-007, `resolve.dedupe: ["yjs"]` en `vite.config.ts`, portar `tokens.css` y `base.css` desde `design/centurion-factory`, actualizar `main.tsx` (jitless primero, sin importar los tokens de `@prdm/ui`) y `index.html` (meta de nonce intacta), y portar a `packages/app/tests/unit` los tests de tokens: sin hex fuera de `tokens.css` y contraste AA

## Contexto
ADR-008 — Port de Centurion Factory a packages/app: tokens, fuentes, íconos, capa de datos y mapa de rutas; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-321`
