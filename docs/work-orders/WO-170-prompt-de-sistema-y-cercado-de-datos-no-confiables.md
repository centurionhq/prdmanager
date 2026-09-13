---
id: "WO-170"
type: "WO"
title: "Prompt de sistema y cercado de datos no confiables con fenceTag y escapeFenceChars, con tests de inyección desde documento y comentarios"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "1686930fb2cf6704"
tags: ["saas","agent","llm","deepseek","security"]
---

## Objetivo
Prompt de sistema y cercado de datos no confiables con fenceTag y escapeFenceChars, con tests de inyección desde documento y comentarios

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-170`
