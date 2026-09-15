---
id: "WO-255"
type: "WO"
title: "HIGH — revisión final WO-203 (arquitectura): buildLlmUsageRepository/buildLlmGlobalUsageRepository (packages/db/src/agent-repository.ts) están muertos en producción — agent-quota.ts reimplementa el mismo UPSERT a llm_usage/llm_global_usage a mano con SQL crudo (strings de tabla/columna, sin pasar po"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "2afac1c3ddee2d9a"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:04.135Z"
completed_at: "2026-09-15T10:49:02.118Z"
resolved_by: ["2cfef3e064007edc47a0ba3d5816d14ae78f216f"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
HIGH — revisión final WO-203 (arquitectura): buildLlmUsageRepository/buildLlmGlobalUsageRepository (packages/db/src/agent-repository.ts) están muertos en producción — agent-quota.ts reimplementa el mismo UPSERT a llm_usage/llm_global_usage a mano con SQL crudo (strings de tabla/columna, sin pasar por el schema tipado), así que un futuro rename de columnas lo detectaría el compilador en un lado y no en el otro, arriesgando el tope diario que protege la clave compartida. Eliminar el método muerto o mover la lógica de reserva atómica a packages/db como única implementación tipada, con test

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-255`
