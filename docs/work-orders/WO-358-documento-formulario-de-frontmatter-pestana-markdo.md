---
id: "WO-358"
type: "WO"
title: "Documento: formulario de frontmatter, pestaña Markdown, presencia, desconexión, solo lectura; actualizar el E2E para clickear \"Markdown\" antes de `.cm-content`"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "adaabeaf01846470"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T23:13:17.726Z"
completed_at: "2026-09-15T23:59:18.841Z"
resolved_by: ["7a8152353973bdf39272b41673352cb908156fa9"]
blueprint_hashes: {"SDD-013":"ad4255dc921ce146bfa0b5f6b30a75f97795dfc5abef66e2c508d1f84a9ea5c7"}
---

## Objetivo
Documento: formulario de frontmatter, pestaña Markdown, presencia, desconexión, solo lectura; actualizar el E2E para clickear "Markdown" antes de `.cm-content`

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-358`
