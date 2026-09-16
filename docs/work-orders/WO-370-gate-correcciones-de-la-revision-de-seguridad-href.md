---
id: "WO-370"
type: "WO"
title: "Gate: correcciones de la revisión de seguridad (hrefs, open redirect de `next=`, XSS en el Markdown renderizado)"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "d213afee8d39d4f3"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T03:25:01.714Z"
completed_at: "2026-09-16T03:54:48.090Z"
resolved_by: ["292bb308ed0e918d1ac352dc2c734218615b47f5"]
blueprint_hashes: {"SDD-013":"ad4255dc921ce146bfa0b5f6b30a75f97795dfc5abef66e2c508d1f84a9ea5c7"}
---

## Objetivo
Gate: correcciones de la revisión de seguridad (hrefs, open redirect de `next=`, XSS en el Markdown renderizado)

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-370`
