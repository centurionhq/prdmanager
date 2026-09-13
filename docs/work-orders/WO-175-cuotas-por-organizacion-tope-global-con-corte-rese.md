---
id: "WO-175"
type: "WO"
title: "Cuotas por organización, tope global con corte, reserva de tokens y rate limit por usuario con errores del proveedor saneados y test de que la clave no aparece en logs"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "a1c68bb008a68646"
tags: ["saas","agent","llm","deepseek","security"]
---

## Objetivo
Cuotas por organización, tope global con corte, reserva de tokens y rate limit por usuario con errores del proveedor saneados y test de que la clave no aparece en logs

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-175`
