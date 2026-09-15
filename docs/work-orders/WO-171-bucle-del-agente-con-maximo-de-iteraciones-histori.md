---
id: "WO-171"
type: "WO"
title: "Bucle del agente con máximo de iteraciones, historial acotado, AbortSignal y tope de tokens, con tests con FakeLlmClient"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "7687f647071ed327"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T19:38:02.666Z"
completed_at: "2026-09-14T19:40:18.997Z"
resolved_by: ["52cadfc271cc6a3906ccf4b27eb8acb6fc3e5477"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
Bucle del agente con máximo de iteraciones, historial acotado, AbortSignal y tope de tokens, con tests con FakeLlmClient

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-171`
