---
id: "WO-040"
type: "WO"
title: "Fijar en packages/web/package.json las versiones exactas del stack e instalar, y crear vite.config.ts con plugin React, outDir dist/client y proxy de /api"
status: "done"
created_at: "2026-09-13"
implements: ["ADR-004"]
impacts_paths: ["packages/web/package.json","packages/web/vite.config.ts"]
source_task: "3470277b11cbc189"
tags: ["architecture-decision","web-ui","frontend","backend"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:07:40.225Z"
completed_at: "2026-09-13T17:10:58.122Z"
resolved_by: ["8ad62e85b1a4639ccdddf9236a12833965bd273c"]
blueprint_hashes: {"ADR-004":"70627f90fe199649864a277dc7e7495497939a0cb877904eafbe496bedcd7645"}
---

## Objetivo
Fijar en packages/web/package.json las versiones exactas del stack e instalar, y crear vite.config.ts con plugin React, outDir dist/client y proxy de /api

## Contexto
ADR-004 — Stack del explorador web: Fastify + Vite + React + Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-004
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-040`
