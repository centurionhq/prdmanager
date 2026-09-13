---
id: "WO-171"
type: "WO"
title: "Bucle del agente con máximo de iteraciones, historial acotado, AbortSignal y tope de tokens, con tests con FakeLlmClient"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "7687f647071ed327"
tags: ["saas","agent","llm","deepseek","security"]
---

## Objetivo
Bucle del agente con máximo de iteraciones, historial acotado, AbortSignal y tope de tokens, con tests con FakeLlmClient

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-171`
