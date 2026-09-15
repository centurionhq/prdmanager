---
id: "WO-340"
type: "WO"
title: "Rutas `GET P/drift/issues`, `GET P/drift/reports/:reportId` con sus sondas"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "c7854e84290844e0"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:47.760Z"
completed_at: "2026-09-15T22:57:10.167Z"
resolved_by: ["ad6317d926b9eddac749c2871b6931277fe7e1ec"]
blueprint_hashes: {"SDD-012":"0336939aca336af80726637b22f16e71472abb89a79c17b468a9921357d6c5a0"}
---

## Objetivo
Rutas `GET P/drift/issues`, `GET P/drift/reports/:reportId` con sus sondas

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-340`
