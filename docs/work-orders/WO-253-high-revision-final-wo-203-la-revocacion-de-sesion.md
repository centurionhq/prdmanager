---
id: "WO-253"
type: "WO"
title: "HIGH — revisión final WO-203: la revocación de sesión (databaseHooks.session.delete.after) nunca llega al SSE de .../agent/messages: la sesión solo se valida una vez al iniciar el turno, y el stream puede durar varios minutos (disableRequestTimeout de WO-227) sin volver a chequear que la sesión siga"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "a69bd1660c60c5c1"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:12:59.825Z"
completed_at: "2026-09-15T10:48:52.813Z"
resolved_by: ["e4cf3f03fd203367c8c8bbd07aef9bbd6fe6e075"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
HIGH — revisión final WO-203: la revocación de sesión (databaseHooks.session.delete.after) nunca llega al SSE de .../agent/messages: la sesión solo se valida una vez al iniciar el turno, y el stream puede durar varios minutos (disableRequestTimeout de WO-227) sin volver a chequear que la sesión siga vigente en cada iteración del loop, solo re-chequea rol/membership por tool call. Agregar un chequeo de sesión vigente en cada iteración (o suscribir el stream a collabRevocationHub), con test de una sesión revocada a mitad de turno

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-253`
