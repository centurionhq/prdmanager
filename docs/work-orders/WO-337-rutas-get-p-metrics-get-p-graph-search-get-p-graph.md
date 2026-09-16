---
id: "WO-337"
type: "WO"
title: "Rutas `GET P/metrics`, `GET P/graph/search`, `GET P/graph/branch/:nodeId` con sus sondas"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "a7d23bc4b0991e4a"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T22:07:34.255Z"
completed_at: "2026-09-15T22:56:54.028Z"
resolved_by: ["2b18f8e747470f4c606259f6f52924bf0c56bdd7"]
blueprint_hashes: {"SDD-012":"89c5f5f1a7b15a0b4e86635ba5a51263d8583e13cd3b5e23116ff98a549bd68d"}
---

## Objetivo
Rutas `GET P/metrics`, `GET P/graph/search`, `GET P/graph/branch/:nodeId` con sus sondas

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-337`
