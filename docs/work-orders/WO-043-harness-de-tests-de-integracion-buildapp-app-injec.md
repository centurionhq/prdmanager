---
id: "WO-043"
type: "WO"
title: "Harness de tests de integración (buildApp + app.inject + fixture de testkit contra Neo4j de test) construido junto con app.ts en la misma tarea, ya que el harness necesita que buildApp exista para compilar"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "06ae782baa512d47"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:34:11.674Z"
completed_at: "2026-09-13T17:36:26.236Z"
resolved_by: ["99cce399e2876fbdd3a21002602d41d3771a7b54"]
blueprint_hashes: {"SDD-005":"40ffb5aa0ac24b9f000c7583fae084fe23ab3990053927e75e87ed56011b93bd"}
---

## Objetivo
Harness de tests de integración (buildApp + app.inject + fixture de testkit contra Neo4j de test) construido junto con app.ts en la misma tarea, ya que el harness necesita que buildApp exista para compilar

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-043`
