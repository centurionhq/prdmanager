---
id: "WO-350"
type: "WO"
title: "Módulos de API para cada ruta de SDD-012 en el barrel `client.ts`, con tests"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "adda1b83430d197e"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:11.637Z"
completed_at: "2026-09-15T22:57:39.377Z"
resolved_by: ["8d1b8d974e245e50a74fc08e5a95ec79c5a5425c"]
blueprint_hashes: {"SDD-013":"ad4255dc921ce146bfa0b5f6b30a75f97795dfc5abef66e2c508d1f84a9ea5c7"}
---

## Objetivo
Módulos de API para cada ruta de SDD-012 en el barrel `client.ts`, con tests

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-350`
