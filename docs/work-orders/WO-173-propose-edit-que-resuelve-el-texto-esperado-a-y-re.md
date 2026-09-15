---
id: "WO-173"
type: "WO"
title: "propose_edit que resuelve el texto esperado a Y.RelativePosition, rechaza ediciones solapadas y campos prohibidos y guarda propuestas pendientes, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "4537dbd0d5dd8ea7"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T19:51:53.967Z"
completed_at: "2026-09-14T19:57:28.446Z"
resolved_by: ["8e534de0b9ce16605d603fe3fb3e8aed04cfb836"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
propose_edit que resuelve el texto esperado a Y.RelativePosition, rechaza ediciones solapadas y campos prohibidos y guarda propuestas pendientes, con tests

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-173`
