---
id: "WO-394"
type: "WO"
title: "Gate post-cierre: reforzar `packages/core/tests/unit/scaffold-link.test.ts` (fix de FB-009) con la aserción de `.gitignore` que le faltaba, cubierto también por el `impacts_paths` de este SDD"
status: "done"
created_at: "2026-09-16"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "a7ec4b4ac0580a35"
tags: ["saas","api","lifecycle","drift","feedback"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T13:03:28.482Z"
completed_at: "2026-09-16T13:03:39.699Z"
resolved_by: ["558771404f29111ec98074c46a791b761346cf3c"]
blueprint_hashes: {"SDD-012":"89c5f5f1a7b15a0b4e86635ba5a51263d8583e13cd3b5e23116ff98a549bd68d"}
---

## Objetivo
Gate post-cierre: reforzar `packages/core/tests/unit/scaffold-link.test.ts` (fix de FB-009) con la aserción de `.gitignore` que le faltaba, cubierto también por el `impacts_paths` de este SDD

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-394`
