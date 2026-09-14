---
id: "WO-175"
type: "WO"
title: "Cuotas por organización, tope global con corte, reserva de tokens y rate limit por usuario con errores del proveedor saneados y test de que la clave no aparece en logs"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "a1c68bb008a68646"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T20:08:13.410Z"
completed_at: "2026-09-14T20:16:09.859Z"
resolved_by: ["2c8ec13239f5ac8ac23ca3dc73951429cefdab0e"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
Cuotas por organización, tope global con corte, reserva de tokens y rate limit por usuario con errores del proveedor saneados y test de que la clave no aparece en logs

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-175`
