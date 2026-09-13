---
id: "WO-071"
type: "WO"
title: "Auditoría de accesibilidad: navegación completa por teclado del árbol y el detalle, aria-labels, contraste 4.5:1 de los tokens en ambos temas"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "8139e530331c64ae"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T19:52:57.351Z"
completed_at: "2026-09-13T19:59:32.597Z"
resolved_by: ["267c4101a2a089a493a90f0ee2cba025364a111f"]
blueprint_hashes: {"SDD-005":"530e81f8f8f7247758c0c8c597631b4db8a4423b4ff091d3363649409424322a"}
---

## Objetivo
Auditoría de accesibilidad: navegación completa por teclado del árbol y el detalle, aria-labels, contraste 4.5:1 de los tokens en ambos temas

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-071`
