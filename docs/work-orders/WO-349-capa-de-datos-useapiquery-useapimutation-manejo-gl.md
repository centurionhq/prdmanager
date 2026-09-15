---
id: "WO-349"
type: "WO"
title: "Capa de datos: `useApiQuery`/`useApiMutation`, manejo global de 401 con `next=` relativo, mapeo de `rate_limited` y `not_found` a copy en español, con tests"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "75a7b238beaf5e27"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:06.490Z"
completed_at: "2026-09-15T22:57:34.694Z"
resolved_by: ["3f511f3f2e87ba716ce409a637737357c0a3581b"]
blueprint_hashes: {"SDD-013":"35e9b00d09ec28b2045d5c60a54198cc1675cb272d6fc0aa35e56802d046e0b0"}
---

## Objetivo
Capa de datos: `useApiQuery`/`useApiMutation`, manejo global de 401 con `next=` relativo, mapeo de `rate_limited` y `not_found` a copy en español, con tests

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-349`
