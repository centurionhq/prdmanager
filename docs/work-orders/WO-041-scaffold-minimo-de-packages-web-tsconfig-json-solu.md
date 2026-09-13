---
id: "WO-041"
type: "WO"
title: "Scaffold mínimo de packages/web: tsconfig.json (solución), tsconfig.server.json, tsconfig.client.json, y un src/server.ts / src/client/main.tsx stub (para que tsc -b tenga inputs y no falle con TS18003)"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "b6057ae9e4733339"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:18:42.248Z"
---

## Objetivo
Scaffold mínimo de packages/web: tsconfig.json (solución), tsconfig.server.json, tsconfig.client.json, y un src/server.ts / src/client/main.tsx stub (para que tsc -b tenga inputs y no falle con TS18003)

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-041`
