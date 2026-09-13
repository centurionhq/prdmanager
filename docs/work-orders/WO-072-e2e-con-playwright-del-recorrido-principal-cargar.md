---
id: "WO-072"
type: "WO"
title: "E2E con Playwright del recorrido principal (cargar, buscar, seleccionar, ver detalle, ver drift) contra servidor real y Neo4j, corrido localmente (no en CI, ver Tests)"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "be7a8ab183434e0c"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
---

## Objetivo
E2E con Playwright del recorrido principal (cargar, buscar, seleccionar, ver detalle, ver drift) contra servidor real y Neo4j, corrido localmente (no en CI, ver Tests)

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-072`
