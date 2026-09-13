---
id: "WO-080"
type: "WO"
title: "CI en .github/workflows/prdm-sync.yml con actions/setup-node leyendo .nvmrc y verificación verde de build, typecheck, test:unit y sync --check en Node 24"
status: "in_progress"
created_at: "2026-09-13"
implements: ["ADR-005"]
impacts_paths: [".nvm[r]c","package.json","package-lock.json","packages/*/package.json","tsconfig.base.json","packages/*/tsconfig*.json","packages/web/tests/**",".github/workflows/prdm-sync.yml","README.md"]
source_task: "e71a4ace62495962"
tags: ["architecture-decision","runtime","node"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T23:30:51.486Z"
---

## Objetivo
CI en .github/workflows/prdm-sync.yml con actions/setup-node leyendo .nvmrc y verificación verde de build, typecheck, test:unit y sync --check en Node 24

## Contexto
ADR-005 — Runtime Node 24 LTS para todo el monorepo; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-080`
