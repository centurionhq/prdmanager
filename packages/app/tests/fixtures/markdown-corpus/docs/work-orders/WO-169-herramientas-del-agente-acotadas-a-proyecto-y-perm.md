---
id: "WO-169"
type: "WO"
title: "Herramientas del agente acotadas a proyecto y permisos (read_document, search_project, get_node, get_feature_branch, get_template, validate_document) con límites de tamaño y sin datos personales, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-009"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/collab/src/**","packages/collab/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/mcp/src/**",".env.example","README.md","package.json","package-lock.json"]
source_task: "e16b869de2b79451"
tags: ["saas","agent","llm","deepseek","security"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T19:25:37.838Z"
completed_at: "2026-09-14T19:32:31.672Z"
resolved_by: ["b2d6fb612394890cd67392f15b08712918bf7c52"]
blueprint_hashes: {"SDD-009":"90ee7b7ff1a2cfa2dcc935c45488f52fd49f945a034388bd3d9cc71a2070d7e5"}
---

## Objetivo
Herramientas del agente acotadas a proyecto y permisos (read_document, search_project, get_node, get_feature_branch, get_template, validate_document) con límites de tamaño y sin datos personales, con tests

## Contexto
SDD-009 — Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-009
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-169`
