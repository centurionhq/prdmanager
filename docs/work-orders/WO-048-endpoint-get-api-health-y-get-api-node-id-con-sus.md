---
id: "WO-048"
type: "WO"
title: "Endpoint GET /api/health y GET /api/node/:id con sus tests de integración"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "de395c8930863792"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:38:15.542Z"
completed_at: "2026-09-13T17:39:25.664Z"
resolved_by: ["2e96ebecd7ca3c6c47736c055e63b07f7534e9c8"]
blueprint_hashes: {"SDD-005":"40ffb5aa0ac24b9f000c7583fae084fe23ab3990053927e75e87ed56011b93bd"}
---

## Objetivo
Endpoint GET /api/health y GET /api/node/:id con sus tests de integración

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-048`
