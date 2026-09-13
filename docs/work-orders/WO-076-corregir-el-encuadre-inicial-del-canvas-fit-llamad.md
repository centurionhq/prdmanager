---
id: "WO-076"
type: "WO"
title: "Corregir el encuadre inicial del canvas: fit() llamado en el mismo tick que la creación de cy ve el contenedor con tamaño 0 y produce un layout colapsado en cada carga a escala real de este repo; diferirlo un frame con requestAnimationFrame (cancelado si el componente se desmonta antes) y sus tests"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "062d0309161e9870"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T19:22:38.127Z"
---

## Objetivo
Corregir el encuadre inicial del canvas: fit() llamado en el mismo tick que la creación de cy ve el contenedor con tamaño 0 y produce un layout colapsado en cada carga a escala real de este repo; diferirlo un frame con requestAnimationFrame (cancelado si el componente se desmonta antes) y sus tests

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-076`
