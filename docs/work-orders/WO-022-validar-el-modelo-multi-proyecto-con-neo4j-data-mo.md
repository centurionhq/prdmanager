---
id: "WO-022"
type: "WO"
title: "Validar el modelo multi-proyecto con neo4j-data-modeling y actualizar docs/model/graph-model.json"
status: "todo"
created_at: "2026-09-13"
implements: ["ADR-002"]
governs: ["package.json","tsconfig*.json","vitest.config.ts","packages/*/package.json","packages/core/src/graph/migrations*.ts"]
source_task: "f95d2143e35aeafe"
tags: ["architecture-decision","multi-project","neo4j","monorepo","atomicity"]
---

## Objetivo
Validar el modelo multi-proyecto con neo4j-data-modeling y actualizar docs/model/graph-model.json

## Contexto
ADR-002 — Aislamiento multi-proyecto, monorepo y commit atómico; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-022`
