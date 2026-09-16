---
id: "WO-167"
type: "WO"
title: "Puerto LlmClient con FakeLlmClient guionado y DeepSeekClient sobre openai 7.15.0 con baseURL, modelo, maxRetries y logger que redacta desde el entorno, con test de contrato contra servidor SSE falso"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "0adebd009d0648f4"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T19:08:40.507Z"
completed_at: "2026-09-14T19:17:11.888Z"
resolved_by: ["3dbf2599859cc4b38ec25ebb00085736f83641da"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
Puerto LlmClient con FakeLlmClient guionado y DeepSeekClient sobre openai 7.15.0 con baseURL, modelo, maxRetries y logger que redacta desde el entorno, con test de contrato contra servidor SSE falso

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-167`
