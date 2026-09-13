---
id: "WO-172"
type: "WO"
title: "Endpoint de mensajes con respuesta SSE para editor o superior, CSRF, conversaciones privadas y una transmisión activa por usuario, con tests"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "ccb54595a634e7c8"
tags: ["saas","agent","llm","deepseek","security"]
---

## Objetivo
Endpoint de mensajes con respuesta SSE para editor o superior, CSRF, conversaciones privadas y una transmisión activa por usuario, con tests

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-172`
