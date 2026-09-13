---
id: "WO-041"
type: "WO"
title: "Scaffold mínimo de packages/web: tsconfig.json (solución), tsconfig.server.json, tsconfig.client.json, y un src/server.ts / src/client/main.tsx stub (para que tsc -b tenga inputs y no falle con TS18003)"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "b6057ae9e4733339"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:18:42.248Z"
completed_at: "2026-09-13T17:18:57.049Z"
resolved_by: ["6b12064d179c9887a34c3ba78f85b0b3d81d4d53"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
Scaffold mínimo de packages/web: tsconfig.json (solución), tsconfig.server.json, tsconfig.client.json, y un src/server.ts / src/client/main.tsx stub (para que tsc -b tenga inputs y no falle con TS18003)

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-041`
