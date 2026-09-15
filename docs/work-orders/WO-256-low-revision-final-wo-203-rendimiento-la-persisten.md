---
id: "WO-256"
type: "WO"
title: "LOW — revisión final WO-203 (rendimiento): la persistencia de mensajes tras cada turno del agente (documents-agent.ts) hace un INSERT por mensaje en un for secuencial en vez de un insert en lote; batchear en un solo insert, con test"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "a0e74366c963e19c"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:06.238Z"
completed_at: "2026-09-15T10:48:55.215Z"
resolved_by: ["e4cf3f03fd203367c8c8bbd07aef9bbd6fe6e075"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
LOW — revisión final WO-203 (rendimiento): la persistencia de mensajes tras cada turno del agente (documents-agent.ts) hace un INSERT por mensaje en un for secuencial en vez de un insert en lote; batchear en un solo insert, con test

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-256`
