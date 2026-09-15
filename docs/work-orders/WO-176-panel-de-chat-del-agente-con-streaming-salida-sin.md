---
id: "WO-176"
type: "WO"
title: "Panel de chat del agente con streaming, salida sin HTML ni imágenes remotas y tarjetas de propuesta con diff que destacan frontmatter y Tareas, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "c99f7c45a60264fc"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T20:16:23.539Z"
completed_at: "2026-09-14T20:29:00.756Z"
resolved_by: ["51a56be9974d468561f70f077590a7e346bcf143"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
Panel de chat del agente con streaming, salida sin HTML ni imágenes remotas y tarjetas de propuesta con diff que destacan frontmatter y Tareas, con tests

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-176`
