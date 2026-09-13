---
id: "WO-022"
type: "WO"
title: "Validar el modelo multi-proyecto con neo4j-data-modeling y actualizar docs/model/graph-model.json"
status: "in_progress"
created_at: "2026-09-13"
implements: ["ADR-002"]
impacts_paths: ["packages/core/src/graph/migrations*.ts","docs/model/**","scripts/validate-graph-model.mjs"]
source_task: "f95d2143e35aeafe"
tags: ["architecture-decision","multi-project","neo4j","monorepo","atomicity"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T08:17:24.132Z"
---

## Objetivo
Validar el modelo multi-proyecto con neo4j-data-modeling y actualizar docs/model/graph-model.json

## Contexto
ADR-002 — Aislamiento multi-proyecto, monorepo y commit atómico; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-022`
