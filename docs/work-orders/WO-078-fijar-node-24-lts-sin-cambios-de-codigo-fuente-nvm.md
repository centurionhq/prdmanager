---
id: "WO-078"
type: "WO"
title: "Fijar Node 24 LTS sin cambios de código fuente: .nvmrc con 24.21.0, engines.node \">=24\" en el package.json raíz y en el de cada paquete, @types/node 24.13.4 y ajustes de tsconfig si hicieran falta, con build, typecheck y tests verdes en Node 24"
status: "in_progress"
created_at: "2026-09-13"
implements: ["ADR-005"]
impacts_paths: [".nvm[r]c","package.json","package-lock.json","packages/*/package.json","tsconfig.base.json","packages/*/tsconfig*.json","packages/web/tests/**",".github/workflows/prdm-sync.yml","README.md"]
source_task: "a0eddb3cb7626f0c"
tags: ["architecture-decision","runtime","node"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T23:22:40.902Z"
---

## Objetivo
Fijar Node 24 LTS sin cambios de código fuente: .nvmrc con 24.21.0, engines.node ">=24" en el package.json raíz y en el de cada paquete, @types/node 24.13.4 y ajustes de tsconfig si hicieran falta, con build, typecheck y tests verdes en Node 24

## Contexto
ADR-005 — Runtime Node 24 LTS para todo el monorepo; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-078`
