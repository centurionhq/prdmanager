---
id: "WO-342"
type: "WO"
title: "Rutas de audit log de proyecto y de organización con sus sondas y un chequeo de canario en la metadata"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "1f955954ceb1a649"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:57.279Z"
completed_at: "2026-09-15T22:57:19.336Z"
resolved_by: ["16b6d343a13a6295aabcbc0a239bb7d253fb24d6"]
blueprint_hashes: {"SDD-012":"89c5f5f1a7b15a0b4e86635ba5a51263d8583e13cd3b5e23116ff98a549bd68d"}
---

## Objetivo
Rutas de audit log de proyecto y de organización con sus sondas y un chequeo de canario en la metadata

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-342`
