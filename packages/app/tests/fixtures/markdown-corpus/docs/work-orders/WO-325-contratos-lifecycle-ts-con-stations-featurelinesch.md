---
id: "WO-325"
type: "WO"
title: "Contratos: `lifecycle.ts` con `STATIONS`, `featureLineSchema`, `lineBoardSchema`, `projectOverviewSchema`, con tests de parseo"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "b0d56fc87fd72ea6"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:02:17.830Z"
completed_at: "2026-09-15T21:52:32.803Z"
resolved_by: ["6a530ac079c0c18793aa6ae9be759396d30e9795"]
blueprint_hashes: {"SDD-012":"89c5f5f1a7b15a0b4e86635ba5a51263d8583e13cd3b5e23116ff98a549bd68d"}
---

## Objetivo
Contratos: `lifecycle.ts` con `STATIONS`, `featureLineSchema`, `lineBoardSchema`, `projectOverviewSchema`, con tests de parseo

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-325`
