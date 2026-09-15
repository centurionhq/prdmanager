---
id: "WO-250"
type: "WO"
title: "CRÍTICO — revisión final WO-203: PgProjectEngine.updateDocument sobre un documento origin:'collab' (closeFeature, el informs de createFeatureRequest) solo encola el cambio en pending_editable_patch, que persistence.ts únicamente aplica al Y.Doc en memoria cuando alguien abre ese editor específico — "
status: "in_progress"
created_at: "2026-09-15"
implements: ["SDD-007"]
impacts_paths: ["packages/core/src/**","packages/core/package.json","packages/mcp/src/**","packages/mcp/package.json","packages/cli/src/**","packages/web/src/**","packages/server/src/**","packages/server/tests/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/testkit/src/**","docs/model/**","scripts/validate-graph-model.mjs","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "01b6e3b584f4cc29"
tags: ["saas","engine","documents","workflow"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:12:53.288Z"
---

## Objetivo
CRÍTICO — revisión final WO-203: PgProjectEngine.updateDocument sobre un documento origin:'collab' (closeFeature, el informs de createFeatureRequest) solo encola el cambio en pending_editable_patch, que persistence.ts únicamente aplica al Y.Doc en memoria cuando alguien abre ese editor específico — nunca toca published_raw, que es lo único que lee scan() para drift/grafo/MCP; closeFeature devuelve éxito y audita feature.closed sin que nada más del sistema lo vea jamás si nadie abre el editor. Los campos que toca closeFeature (status, closed_at, closed_by) son "gestionados por el servidor" (fuera del Y.Doc por diseño, según el plan original) — no deberían pasar por pending_editable_patch en absoluto: escribirlos directo a published_raw (nueva document_versions con reason 'engine_write', igual que writeGeneratedContent) y, si hay una sesión de collab viva, aplicarlos también a su Y.Doc vía una transacción atribuida real (openDirectConnection, mismo patrón que restore.ts/accept-agent-proposal.ts), no vía pending_editable_patch. Con test de que closeFeature es visible en scan()/drift sin que nadie abra el editor

## Contexto
SDD-007 — Puerto ProjectEngine y documentos del SaaS sobre Postgres; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-007
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-250`
