---
id: "WO-040"
type: "WO"
title: "Fijar en packages/web/package.json las versiones exactas del stack e instalar, y crear vite.config.ts con plugin React, outDir dist/client y proxy de /api"
status: "pending"
created_at: "2026-09-13"
implements: ["ADR-004"]
impacts_paths: ["packages/web/package.json","packages/web/vite.config.ts"]
source_task: "3470277b11cbc189"
tags: ["architecture-decision","web-ui","frontend","backend"]
---

## Objetivo
Fijar en packages/web/package.json las versiones exactas del stack e instalar, y crear vite.config.ts con plugin React, outDir dist/client y proxy de /api

## Contexto
ADR-004 — Stack del explorador web: Fastify + Vite + React + Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-004
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-040`
