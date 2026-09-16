---
id: "WO-334"
type: "WO"
title: "Engine: `buildDriftInput` lee `project_code_refs` en vez de un mapa vacío, excluyendo blueprints desactualizados por hash y filas de otro `hash_algo_version`, con tests de: `governs` acumula entre sincronizaciones; un hash distinto produce `code_changed`; un blueprint sin cambios queda intacto; Neo4"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "1f1e35cc419965d2"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:02:57.151Z"
completed_at: "2026-09-15T21:57:21.782Z"
resolved_by: ["8a713b224be0fdab78af3272e46e8378be56103f"]
blueprint_hashes: {"SDD-012":"d425e24bdec27ebfeed89dd830ca2ba9e8d9b34103adffd8aca1417799ccb1cd"}
---

## Objetivo
Engine: `buildDriftInput` lee `project_code_refs` en vez de un mapa vacío, excluyendo blueprints desactualizados por hash y filas de otro `hash_algo_version`, con tests de: `governs` acumula entre sincronizaciones; un hash distinto produce `code_changed`; un blueprint sin cambios queda intacto; Neo4j recibe `CodeRef`/`GOVERNED_BY`; `systemIntegrity` es mayor que 0/0

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-334`
