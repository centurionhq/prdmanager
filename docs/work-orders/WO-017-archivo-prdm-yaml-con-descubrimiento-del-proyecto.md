---
id: "WO-017"
type: "WO"
title: "Archivo .prdm.yaml con descubrimiento del proyecto activo y mapa de carpetas por tipo de documento"
status: "todo"
created_at: "2026-09-13"
implements: ["SDD-002"]
governs: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "0a6af19bb432e489"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
---

## Objetivo
Archivo .prdm.yaml con descubrimiento del proyecto activo y mapa de carpetas por tipo de documento

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-017`
