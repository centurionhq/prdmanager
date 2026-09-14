---
id: "WO-209"
type: "WO"
title: "Corregir que timeoutMs del test de estrés multi-proceso del lock era menor que staleAfterMs, así que ningún proceso en espera llegaba a beneficiarse de la recuperación por staleness bajo contención real de CI y siempre se rendía primero; reordenar los márgenes y widen los timeouts externos en propor"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "6c0f6f6fdc393495"
tags: ["saas","engine","documents","workflow"]
---

## Objetivo
Corregir que timeoutMs del test de estrés multi-proceso del lock era menor que staleAfterMs, así que ningún proceso en espera llegaba a beneficiarse de la recuperación por staleness bajo contención real de CI y siempre se rendía primero; reordenar los márgenes y widen los timeouts externos en proporción

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-209`
