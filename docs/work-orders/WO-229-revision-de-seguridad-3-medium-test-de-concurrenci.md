---
id: "WO-229"
type: "WO"
title: "Revisión de seguridad #3 (MEDIUM): test de concurrencia real (Promise.all) contra Postgres real para la aceptación simultánea de la misma propuesta, verificando que solo una gana y la otra recibe conflicto"
status: "done"
created_at: "2026-09-14"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "a8f5812705ca9564"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T21:40:46.784Z"
completed_at: "2026-09-14T21:44:39.903Z"
resolved_by: ["a3cde5b4e55bef98db46398d8e1bf20a5256253d"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
Revisión de seguridad #3 (MEDIUM): test de concurrencia real (Promise.all) contra Postgres real para la aceptación simultánea de la misma propuesta, verificando que solo una gana y la otra recibe conflicto

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-229`
