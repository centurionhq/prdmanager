---
id: "WO-079"
type: "WO"
title: "Subir jsdom de 27.4.0 a 30.0.1 en packages/web y ajustar los tests de cliente que fallen"
status: "done"
created_at: "2026-09-13"
implements: ["ADR-005"]
impacts_paths: [".nvm[r]c","package.json","package-lock.json","packages/*/package.json","tsconfig.base.json","packages/*/tsconfig*.json","packages/web/tests/**",".github/workflows/prdm-sync.yml","README.md"]
source_task: "6a04374b2cf053c5"
tags: ["architecture-decision","runtime","node"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T23:25:36.477Z"
completed_at: "2026-09-13T23:30:31.871Z"
resolved_by: ["30ce702aaa3f8b04a141870d8e7b41a0aa2f28d5"]
blueprint_hashes: {"ADR-005":"c874056ae7e5c73ec695fffca17812b8bc55eba088b4bd9fd4a8fe0d6c6e4684"}
---

## Objetivo
Subir jsdom de 27.4.0 a 30.0.1 en packages/web y ajustar los tests de cliente que fallen

## Contexto
ADR-005 — Runtime Node 24 LTS para todo el monorepo; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-079`
