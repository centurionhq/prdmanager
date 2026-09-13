---
id: "WO-017"
type: "WO"
title: "Archivo .prdm.yaml con descubrimiento del proyecto activo y mapa de carpetas por tipo de documento"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "0a6af19bb432e489"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T06:45:54.134Z"
completed_at: "2026-09-13T07:11:24.641Z"
resolved_by: ["242284f5e92fb5bbc78a91571006742ce4b74105"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Archivo .prdm.yaml con descubrimiento del proyecto activo y mapa de carpetas por tipo de documento

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-017`
