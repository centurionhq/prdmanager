---
id: "WO-173"
type: "WO"
title: "propose_edit que resuelve el texto esperado a Y.RelativePosition, rechaza ediciones solapadas y campos prohibidos y guarda propuestas pendientes, con tests"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "4537dbd0d5dd8ea7"
tags: ["saas","agent","llm","deepseek","security"]
---

## Objetivo
propose_edit que resuelve el texto esperado a Y.RelativePosition, rechaza ediciones solapadas y campos prohibidos y guarda propuestas pendientes, con tests

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-173`
