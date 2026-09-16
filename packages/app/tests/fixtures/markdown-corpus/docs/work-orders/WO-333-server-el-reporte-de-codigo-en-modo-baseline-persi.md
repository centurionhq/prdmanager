---
id: "WO-333"
type: "WO"
title: "Server: el reporte de código en modo baseline persiste `project_code_refs` y `governed_warnings` en la misma transacción que el head de baseline; un reporte de vista previa nunca escribe; reintento con la misma `Idempotency-Key` es idempotente; con tests"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "bbfe151cc0a8498f"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T21:02:52.673Z"
completed_at: "2026-09-15T21:53:11.155Z"
resolved_by: ["7ee6d439865ebf315ba9bf089624aed3f79fa217"]
blueprint_hashes: {"SDD-012":"89c5f5f1a7b15a0b4e86635ba5a51263d8583e13cd3b5e23116ff98a549bd68d"}
---

## Objetivo
Server: el reporte de código en modo baseline persiste `project_code_refs` y `governed_warnings` en la misma transacción que el head de baseline; un reporte de vista previa nunca escribe; reintento con la misma `Idempotency-Key` es idempotente; con tests

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-333`
