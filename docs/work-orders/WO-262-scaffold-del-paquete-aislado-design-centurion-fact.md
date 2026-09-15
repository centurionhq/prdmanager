---
id: "WO-262"
type: "WO"
title: "Scaffold del paquete aislado design/centurion-factory: package.json con versiones fijadas de packages/app y engines node>=24, tsconfig, vite.config.ts, vitest.config.ts, index.html y .gitignore (node_modules, dist, screenshots), con smoke test y verificación de que ningún archivo raíz cambió"
status: "done"
created_at: "2026-09-15"
implements: ["ADR-007"]
impacts_paths: ["design/centurion-factory/*.json","design/centurion-factory/*.config.ts","design/centurion-factory/index.htm[l]","design/centurion-factory/src/styles/**"]
source_task: "9c7d02d728d6acba"
tags: ["architecture-decision","design","frontend","mock"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T14:44:57.347Z"
completed_at: "2026-09-15T14:46:18.038Z"
resolved_by: ["6acdaafdc585fb39d317b9ce07095353718bdfde"]
blueprint_hashes: {"ADR-007":"c25d8a138b8055e630fe69d36c75e55fb8efbde74222cdf73e57c6e10e3a2540"}
---

## Objetivo
Scaffold del paquete aislado design/centurion-factory: package.json con versiones fijadas de packages/app y engines node>=24, tsconfig, vite.config.ts, vitest.config.ts, index.html y .gitignore (node_modules, dist, screenshots), con smoke test y verificación de que ningún archivo raíz cambió

## Contexto
ADR-007 — Paquete de diseño aislado: CSS Modules + tokens, fuentes self-hosted, fuera de workspaces; features: PRD-006

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-262`
