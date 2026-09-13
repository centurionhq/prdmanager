---
id: "WO-023"
type: "WO"
title: "Endurecer la transacción atómica tras la revisión: journal autenticado y acotado a documentos, lock con exclusión mutua real, rollback que no borra archivos ajenos y borradores sin pisar ediciones concurrentes"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "1009d17cf6599387"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T08:49:42.225Z"
completed_at: "2026-09-13T09:33:21.993Z"
resolved_by: ["765c4a0102ac91f65cb74774042d88e725f1776e"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Endurecer la transacción atómica tras la revisión: journal autenticado y acotado a documentos, lock con exclusión mutua real, rollback que no borra archivos ajenos y borradores sin pisar ediciones concurrentes

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-023`
