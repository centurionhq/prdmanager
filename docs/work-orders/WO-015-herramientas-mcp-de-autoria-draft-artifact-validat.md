---
id: "WO-015"
type: "WO"
title: "Herramientas MCP de autoría draft_artifact, validate_draft y commit_artifact con el prompt conversacional author_artifact"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "1fc2e691047c815e"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T08:17:22.597Z"
completed_at: "2026-09-13T08:35:50.718Z"
resolved_by: ["22da1337e3faaeca3376a2aecb154df15dc48670"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Herramientas MCP de autoría draft_artifact, validate_draft y commit_artifact con el prompt conversacional author_artifact

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-015`
