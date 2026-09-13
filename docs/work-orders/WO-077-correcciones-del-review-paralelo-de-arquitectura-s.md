---
id: "WO-077"
type: "WO"
title: "Correcciones del review paralelo de arquitectura/seguridad/rendimiento (F6): isAllowedHost no reconocía [::1] aunque resolveWebBind sí lo aceptaba como loopback (arrancaba y luego rechazaba todo con 403); un nodo nuevo introducido entre refrescos quedaba en (0,0) para siempre al no re-correr layout;"
status: "in_progress"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "e8d52b641f7942aa"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T20:06:13.651Z"
---

## Objetivo
Correcciones del review paralelo de arquitectura/seguridad/rendimiento (F6): isAllowedHost no reconocía [::1] aunque resolveWebBind sí lo aceptaba como loopback (arrancaba y luego rechazaba todo con 403); un nodo nuevo introducido entre refrescos quedaba en (0,0) para siempre al no re-correr layout; el stylesheet del canvas no se reaplicaba ante un cambio en vivo de tema del SO; el guard de imports de @prdm/core no detectaba un import() dinámico; el test de path traversal no afirmaba el status code; y sus tests

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-077`
