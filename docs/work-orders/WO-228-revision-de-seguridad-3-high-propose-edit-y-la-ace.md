---
id: "WO-228"
type: "WO"
title: "Revisión de seguridad #3 (HIGH): propose_edit y la aceptación de propuestas deben respetar el mismo freeze de solo lectura que ya aplica a la edición humana (documento archivado o de origin generated), tanto al crear la propuesta como al aceptarla, con tests de ambos casos"
status: "done"
created_at: "2026-09-14"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "0e0fe8252ba3d0e6"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T21:32:59.745Z"
completed_at: "2026-09-14T21:40:29.140Z"
resolved_by: ["ab2a96f2bdb150dc5f26a867fd85d388d8d124bb"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
Revisión de seguridad #3 (HIGH): propose_edit y la aceptación de propuestas deben respetar el mismo freeze de solo lectura que ya aplica a la edición humana (documento archivado o de origin generated), tanto al crear la propuesta como al aceptarla, con tests de ambos casos

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-228`
