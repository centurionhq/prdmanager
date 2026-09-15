---
id: "WO-081"
type: "WO"
title: "README con el requisito de Node 24 instalado a nivel usuario con nvm"
status: "done"
created_at: "2026-09-13"
implements: ["ADR-005"]
impacts_paths: [".nvm[r]c","package.json","package-lock.json","packages/*/package.json","tsconfig.base.json","packages/*/tsconfig*.json","packages/web/tests/**",".github/workflows/prdm-sync.yml","README.md"]
source_task: "e1b71da172edc241"
tags: ["architecture-decision","runtime","node"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T23:32:33.619Z"
completed_at: "2026-09-13T23:33:20.020Z"
resolved_by: ["6a55da9d10ad30f09345a037833fe3a3ac698860"]
blueprint_hashes: {"ADR-005":"c874056ae7e5c73ec695fffca17812b8bc55eba088b4bd9fd4a8fe0d6c6e4684"}
---

## Objetivo
README con el requisito de Node 24 instalado a nivel usuario con nvm

## Contexto
ADR-005 — Runtime Node 24 LTS para todo el monorepo; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-081`
