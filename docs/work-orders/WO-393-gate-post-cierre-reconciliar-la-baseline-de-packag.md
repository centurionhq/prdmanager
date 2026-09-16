---
id: "WO-393"
type: "WO"
title: "Gate post-cierre: reconciliar la baseline de `packages/core/tests/unit/scaffold-link.test.ts` tras el fix de FB-009 (WO-391), que también cae bajo el `impacts_paths` de este SDD"
status: "done"
created_at: "2026-09-16"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "ecf3b06bdd97763f"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T12:55:55.841Z"
completed_at: "2026-09-16T12:56:39.263Z"
resolved_by: ["52fd37e5792353759eff6ecb7e1339940c134018"]
blueprint_hashes: {"SDD-012":"89c5f5f1a7b15a0b4e86635ba5a51263d8583e13cd3b5e23116ff98a549bd68d"}
---

## Objetivo
Gate post-cierre: reconciliar la baseline de `packages/core/tests/unit/scaffold-link.test.ts` tras el fix de FB-009 (WO-391), que también cae bajo el `impacts_paths` de este SDD

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-393`
