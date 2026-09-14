---
id: "WO-211"
type: "WO"
title: "Restaurar staleAfterMs a 30s en el test de estrés del lock: bajarlo a 8s (intento anterior) desalojó un lock todavía vigente bajo contención real de CI y produjo una violación de exclusión mutua genuina (EEXIST), no solo un timeout; 30s ya estaba validado sin violaciones en corridas previas, así que"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "6e62f46209b970e8"
tags: ["saas","engine","documents","workflow"]
---

## Objetivo
Restaurar staleAfterMs a 30s en el test de estrés del lock: bajarlo a 8s (intento anterior) desalojó un lock todavía vigente bajo contención real de CI y produjo una violación de exclusión mutua genuina (EEXIST), no solo un timeout; 30s ya estaba validado sin violaciones en corridas previas, así que el arreglo real era únicamente que timeoutMs supere a staleAfterMs, no achicar este último

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-211`
