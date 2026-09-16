---
id: "WO-058"
type: "WO"
title: "Función pura to-elements de Subgraph a elementos de Cytoscape, y sus tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "bb4201409d34faaf"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T18:10:23.588Z"
completed_at: "2026-09-13T18:11:28.825Z"
resolved_by: ["14a57f0d3d693c930cd6d6d0da6041ac81a02c62"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
Función pura to-elements de Subgraph a elementos de Cytoscape, y sus tests

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-058`
