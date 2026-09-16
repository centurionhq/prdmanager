---
id: "WO-389"
type: "WO"
title: "Gate: correcciones post-cierre encontradas por CI en `full-journey.spec.ts` (paneles con tabs de WO-359, colisión de `getByLabel('Título')` en el frontmatter)"
status: "done"
created_at: "2026-09-16"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/package.json","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "293e01a690225545"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T11:26:23.425Z"
completed_at: "2026-09-16T11:27:25.048Z"
resolved_by: ["a34fc4807b6fa8a1c20474c49f7f81119f490d50"]
blueprint_hashes: {"SDD-013":"ad4255dc921ce146bfa0b5f6b30a75f97795dfc5abef66e2c508d1f84a9ea5c7"}
---

## Objetivo
Gate: correcciones post-cierre encontradas por CI en `full-journey.spec.ts` (paneles con tabs de WO-359, colisión de `getByLabel('Título')` en el frontmatter)

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-389`
