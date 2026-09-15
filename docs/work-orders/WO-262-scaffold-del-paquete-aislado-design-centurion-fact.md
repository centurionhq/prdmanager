---
id: "WO-262"
type: "WO"
title: "Scaffold del paquete aislado design/centurion-factory: package.json con versiones fijadas de packages/app y engines node>=24, tsconfig, vite.config.ts, vitest.config.ts, index.html y .gitignore (node_modules, dist, screenshots), con smoke test y verificación de que ningún archivo raíz cambió"
status: "pending"
created_at: "2026-09-15"
implements: ["ADR-007"]
impacts_paths: ["design/centurion-factory/*.json","design/centurion-factory/*.config.ts","design/centurion-factory/index.htm[l]","design/centurion-factory/src/styles/**"]
source_task: "9c7d02d728d6acba"
tags: ["architecture-decision","design","frontend","mock"]
---

## Objetivo
Scaffold del paquete aislado design/centurion-factory: package.json con versiones fijadas de packages/app y engines node>=24, tsconfig, vite.config.ts, vitest.config.ts, index.html y .gitignore (node_modules, dist, screenshots), con smoke test y verificación de que ningún archivo raíz cambió

## Contexto
ADR-007 — Paquete de diseño aislado: CSS Modules + tokens, fuentes self-hosted, fuera de workspaces; features: PRD-006

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-262`
