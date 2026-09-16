---
id: "WO-372"
type: "WO"
title: "Dogfooding: `prdm link --import` de este repositorio a una instancia SaaS local; comparar Planta, Árbol y Entrada contra `prdm tree` local; los hallazgos quedan como FB nuevos; actualizar el README con la guía de dev de `packages/app` conectado"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "578e116a4bc17f57"
tags: ["saas","frontend","design","canvas","e2e"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T04:58:39.850Z"
completed_at: "2026-09-16T05:17:37.473Z"
resolved_by: ["65e887bbd16f173d546355ab8d265f3cea32c938"]
blueprint_hashes: {"SDD-013":"ad4255dc921ce146bfa0b5f6b30a75f97795dfc5abef66e2c508d1f84a9ea5c7"}
---

## Objetivo
Dogfooding: `prdm link --import` de este repositorio a una instancia SaaS local; comparar Planta, Árbol y Entrada contra `prdm tree` local; los hallazgos quedan como FB nuevos; actualizar el README con la guía de dev de `packages/app` conectado

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-372`
