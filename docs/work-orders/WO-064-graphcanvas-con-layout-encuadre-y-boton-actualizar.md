---
id: "WO-064"
type: "WO"
title: "GraphCanvas con layout, encuadre y botón Actualizar preservando pan y zoom"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "996eb06375cf62bc"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T19:12:16.736Z"
---

## Objetivo
GraphCanvas con layout, encuadre y botón Actualizar preservando pan y zoom

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-064`
