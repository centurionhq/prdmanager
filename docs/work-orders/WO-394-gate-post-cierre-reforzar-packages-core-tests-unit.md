---
id: "WO-394"
type: "WO"
title: "Gate post-cierre: reforzar `packages/core/tests/unit/scaffold-link.test.ts` (fix de FB-009) con la aserción de `.gitignore` que le faltaba, cubierto también por el `impacts_paths` de este SDD"
status: "pending"
created_at: "2026-09-16"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "a7ec4b4ac0580a35"
tags: ["saas","api","lifecycle","drift","feedback"]
---

## Objetivo
Gate post-cierre: reforzar `packages/core/tests/unit/scaffold-link.test.ts` (fix de FB-009) con la aserción de `.gitignore` que le faltaba, cubierto también por el `impacts_paths` de este SDD

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-394`
