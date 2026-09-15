---
id: "WO-352"
type: "WO"
title: "Login (con paso de verificación en dos pasos), reseteo de contraseña, aceptar invitación; actualizar el helper `login()` del E2E"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "c6fca5e31cf909f0"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:20.543Z"
completed_at: "2026-09-15T22:57:51.168Z"
resolved_by: ["197f16370aa34470ac97dfe8f30814f4e9bdea5a"]
blueprint_hashes: {"SDD-013":"35e9b00d09ec28b2045d5c60a54198cc1675cb272d6fc0aa35e56802d046e0b0"}
---

## Objetivo
Login (con paso de verificación en dos pasos), reseteo de contraseña, aceptar invitación; actualizar el helper `login()` del E2E

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-352`
