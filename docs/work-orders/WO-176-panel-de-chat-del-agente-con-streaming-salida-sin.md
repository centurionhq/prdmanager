---
id: "WO-176"
type: "WO"
title: "Panel de chat del agente con streaming, salida sin HTML ni imágenes remotas y tarjetas de propuesta con diff que destacan frontmatter y Tareas, con tests"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "c99f7c45a60264fc"
tags: ["saas","agent","llm","deepseek","security"]
---

## Objetivo
Panel de chat del agente con streaming, salida sin HTML ni imágenes remotas y tarjetas de propuesta con diff que destacan frontmatter y Tareas, con tests

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-176`
