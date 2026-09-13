---
id: "WO-167"
type: "WO"
title: "Puerto LlmClient con FakeLlmClient guionado y DeepSeekClient sobre openai 7.15.0 con baseURL, modelo, maxRetries y logger que redacta desde el entorno, con test de contrato contra servidor SSE falso"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "0adebd009d0648f4"
tags: ["saas","agent","llm","deepseek","security"]
---

## Objetivo
Puerto LlmClient con FakeLlmClient guionado y DeepSeekClient sobre openai 7.15.0 con baseURL, modelo, maxRetries y logger que redacta desde el entorno, con test de contrato contra servidor SSE falso

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-167`
