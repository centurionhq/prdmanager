---
id: "WO-227"
type: "WO"
title: "Deshabilitar el requestTimeout/headersTimeout por defecto de Node (5 min) en la conexión SSE de .../agent/messages: verificado con la clave real que este modelo puede tardar varios minutos en producir el primer token útil incluso en una respuesta trivial, con test de que se llama setTimeout(0) al in"
status: "in_progress"
created_at: "2026-09-14"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "b90a2082beb4d5b3"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T21:11:34.207Z"
---

## Objetivo
Deshabilitar el requestTimeout/headersTimeout por defecto de Node (5 min) en la conexión SSE de .../agent/messages: verificado con la clave real que este modelo puede tardar varios minutos en producir el primer token útil incluso en una respuesta trivial, con test de que se llama setTimeout(0) al iniciar el stream

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-227`
