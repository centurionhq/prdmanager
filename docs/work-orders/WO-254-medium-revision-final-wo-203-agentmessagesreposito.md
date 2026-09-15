---
id: "WO-254"
type: "WO"
title: "MEDIUM — revisión final WO-203: AgentMessagesRepository.listForConversation (agent-repository.ts) no tiene LIMIT: trae el historial completo de la conversación en cada turno y en cada restauración de conversación (GET .../agent/conversation), aunque runAgentLoop solo reenvía las últimas maxHistoryMe"
status: "in_progress"
created_at: "2026-09-15"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "49fa80088775668b"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:02.071Z"
---

## Objetivo
MEDIUM — revisión final WO-203: AgentMessagesRepository.listForConversation (agent-repository.ts) no tiene LIMIT: trae el historial completo de la conversación en cada turno y en cada restauración de conversación (GET .../agent/conversation), aunque runAgentLoop solo reenvía las últimas maxHistoryMessages (40) al modelo. Agregar límite/paginación acorde a lo que realmente se usa, con test

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-254`
