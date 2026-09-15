---
id: "WO-254"
type: "WO"
title: "MEDIUM — revisión final WO-203: AgentMessagesRepository.listForConversation (agent-repository.ts) no tiene LIMIT: trae el historial completo de la conversación en cada turno y en cada restauración de conversación (GET .../agent/conversation), aunque runAgentLoop solo reenvía las últimas maxHistoryMe"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "49fa80088775668b"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:02.071Z"
completed_at: "2026-09-15T10:48:59.835Z"
resolved_by: ["2cfef3e064007edc47a0ba3d5816d14ae78f216f"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
MEDIUM — revisión final WO-203: AgentMessagesRepository.listForConversation (agent-repository.ts) no tiene LIMIT: trae el historial completo de la conversación en cada turno y en cada restauración de conversación (GET .../agent/conversation), aunque runAgentLoop solo reenvía las últimas maxHistoryMessages (40) al modelo. Agregar límite/paginación acorde a lo que realmente se usa, con test

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-254`
