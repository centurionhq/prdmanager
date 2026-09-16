---
id: "WO-320"
type: "WO"
title: "Learning test en `packages/server/tests/learning`: sirviendo `packages/app/dist` con el servidor real, confirmar que las fuentes self-hosted y el CSS de CSS Modules cargan sin ninguna violación de la CSP real (`style-src 'self' 'nonce-…'`, `font-src 'self'`) en Chromium"
status: "done"
created_at: "2026-09-15"
implements: ["ADR-008"]
impacts_paths: ["packages/app/package.json","packages/app/vite.config.ts","packages/app/index.htm[l]","packages/app/src/main.tsx","packages/app/src/styles/**","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "2d39ac18c9710893"
tags: ["architecture-decision","design","frontend","saas"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:01:55.099Z"
completed_at: "2026-09-15T21:29:14.970Z"
resolved_by: ["43f7248791b47e6f0c8bc5cd55f309c8772e6988"]
blueprint_hashes: {"ADR-008":"1f07b3185476edfb48331daed34fe8636722e66c1c28dacebd89041b95f6657e"}
---

## Objetivo
Learning test en `packages/server/tests/learning`: sirviendo `packages/app/dist` con el servidor real, confirmar que las fuentes self-hosted y el CSS de CSS Modules cargan sin ninguna violación de la CSP real (`style-src 'self' 'nonce-…'`, `font-src 'self'`) en Chromium

## Contexto
ADR-008 — Port de Centurion Factory a packages/app: tokens, fuentes, íconos, capa de datos y mapa de rutas; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-320`
