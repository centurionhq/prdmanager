---
id: "WO-329"
type: "WO"
title: "Core: `sync/issue-attribution.ts` con `attributeIssue` y el cálculo del andon por feature y por proyecto, con tests"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "999e5b1638e0c7f1"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:02:35.417Z"
completed_at: "2026-09-15T21:52:51.448Z"
resolved_by: ["6dac588a696554143a5b6525a936a8229e2e1e4e"]
blueprint_hashes: {"SDD-012":"89c5f5f1a7b15a0b4e86635ba5a51263d8583e13cd3b5e23116ff98a549bd68d"}
---

## Objetivo
Core: `sync/issue-attribution.ts` con `attributeIssue` y el cálculo del andon por feature y por proyecto, con tests

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-329`
