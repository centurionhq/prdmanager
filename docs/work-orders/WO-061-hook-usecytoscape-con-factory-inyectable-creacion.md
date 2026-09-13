---
id: "WO-061"
type: "WO"
title: "Hook useCytoscape con factory inyectable, creación única, refresco con cy.json y destroy al desmontar, y sus tests con cytoscape headless"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "40c952bac31c68f0"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
---

## Objetivo
Hook useCytoscape con factory inyectable, creación única, refresco con cy.json y destroy al desmontar, y sus tests con cytoscape headless

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-061`
