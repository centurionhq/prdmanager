---
id: "WO-012"
type: "WO"
title: "Modelo multi-proyecto en Neo4j: nodo Project, BELONGS_TO, constraints compuestas, migraciones versionadas y store ligado al proyecto"
status: "todo"
created_at: "2026-09-13"
implements: ["SDD-002"]
governs: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "236c4590a550788c"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
---

## Objetivo
Modelo multi-proyecto en Neo4j: nodo Project, BELONGS_TO, constraints compuestas, migraciones versionadas y store ligado al proyecto

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-012`
