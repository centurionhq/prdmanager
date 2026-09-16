---
id: "WO-028"
type: "WO"
title: "Ajustar CI para que el checker de la base solo corra cuando la base ya adoptó prdm y su checkout no contamine sync --check"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-002"]
impacts_paths: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**","packages/testkit/src/**","package.json","packages/*/package.json","tsconfig*.json","packages/*/tsconfig*.json","vitest.config.ts",".github/workflows/prdm-sync.yml"]
source_task: "49b9ed03507b95af"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T13:41:33.047Z"
completed_at: "2026-09-13T13:41:53.497Z"
resolved_by: ["86394c2eb0e5e34dab334b2fa5dad1a1d4da3f81"]
blueprint_hashes: {"SDD-002":"8a28886b5f1a3558350087873d184acbdbf2dfbccf051abae33f2863f5ada48b"}
---

## Objetivo
Ajustar CI para que el checker de la base solo corra cuando la base ya adoptó prdm y su checkout no contamine sync --check

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-028`
