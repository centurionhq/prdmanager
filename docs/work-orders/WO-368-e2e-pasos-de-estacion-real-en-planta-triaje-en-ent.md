---
id: "WO-368"
type: "WO"
title: "E2E: pasos de estación real en Planta, triaje en Entrada, reclamar en Órdenes; listener de `securitypolicyviolation` que falla el test"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "c6a5bfb18f0a2c5b"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T03:24:47.053Z"
completed_at: "2026-09-16T04:56:50.382Z"
resolved_by: ["d4b37b53782147d892861059044bcaa17d059090"]
blueprint_hashes: {"SDD-013":"35e9b00d09ec28b2045d5c60a54198cc1675cb272d6fc0aa35e56802d046e0b0"}
---

## Objetivo
E2E: pasos de estación real en Planta, triaje en Entrada, reclamar en Órdenes; listener de `securitypolicyviolation` que falla el test

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-368`
