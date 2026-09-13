---
id: "WO-057"
type: "WO"
title: "Cliente de API tipado (import type de @prdm/core, sin import de valor) con manejo de ApiError, y sus tests con guard contra imports de valor del core"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "44be980c87b09d52"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
---

## Objetivo
Cliente de API tipado (import type de @prdm/core, sin import de valor) con manejo de ApiError, y sus tests con guard contra imports de valor del core

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-057`
