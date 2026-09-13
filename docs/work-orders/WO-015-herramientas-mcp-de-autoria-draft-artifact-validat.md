---
id: "WO-015"
type: "WO"
title: "Herramientas MCP de autoría draft_artifact, validate_draft y commit_artifact con el prompt conversacional author_artifact"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "1fc2e691047c815e"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
---

## Objetivo
Herramientas MCP de autoría draft_artifact, validate_draft y commit_artifact con el prompt conversacional author_artifact

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-015`
