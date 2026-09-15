---
id: "WO-355"
type: "WO"
title: "Árbol de features, con trazabilidad de código real (`GET P/code-refs`, `GET P/commits`) y el modal de cierre"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "926d6109735d9ab9"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T23:13:03.268Z"
completed_at: "2026-09-15T23:41:09.179Z"
resolved_by: ["ff96b6be9382c6d23d6292a5e9ee90ba468ed24e"]
blueprint_hashes: {"SDD-013":"35e9b00d09ec28b2045d5c60a54198cc1675cb272d6fc0aa35e56802d046e0b0"}
---

## Objetivo
Árbol de features, con trazabilidad de código real (`GET P/code-refs`, `GET P/commits`) y el modal de cierre

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-355`
