---
id: "WO-081"
type: "WO"
title: "README con el requisito de Node 24 instalado a nivel usuario con nvm"
status: "pending"
created_at: "2026-09-13"
implements: ["ADR-005"]
impacts_paths: [".nvm[r]c","package.json","package-lock.json","packages/*/package.json","tsconfig.base.json","packages/*/tsconfig*.json","packages/web/tests/**",".github/workflows/prdm-sync.yml","README.md"]
source_task: "e1b71da172edc241"
tags: ["architecture-decision","runtime","node"]
---

## Objetivo
README con el requisito de Node 24 instalado a nivel usuario con nvm

## Contexto
ADR-005 — Runtime Node 24 LTS para todo el monorepo; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-081`
