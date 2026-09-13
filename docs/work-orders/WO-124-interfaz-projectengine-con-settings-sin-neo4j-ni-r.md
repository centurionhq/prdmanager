---
id: "WO-124"
type: "WO"
title: "Interfaz ProjectEngine con settings sin neo4j ni root, lastReport y scan, implementada por Engine y usada para tipar las funciones de dominio, con guardia de raíz absoluta en safe-fs"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "d752f632d8844cc2"
tags: ["saas","engine","documents","workflow"]
---

## Objetivo
Interfaz ProjectEngine con settings sin neo4j ni root, lastReport y scan, implementada por Engine y usada para tipar las funciones de dominio, con guardia de raíz absoluta en safe-fs

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-124`
