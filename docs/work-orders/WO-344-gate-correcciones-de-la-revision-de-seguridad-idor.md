---
id: "WO-344"
type: "WO"
title: "Gate: correcciones de la revisión de seguridad (IDOR, alcance de RLS de las rutas nuevas, límites de tasa donde falten, cobertura de auditoría)"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-012"]
impacts_paths: ["packages/contracts/src/**","packages/contracts/tests/**","packages/core/src/**","packages/core/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/server/src/**","packages/server/tests/**","packages/mcp/src/**","package.json","package-lock.json","vitest.config.ts","tsconfig.test.json"]
source_task: "c959dd82dab6d5f1"
tags: ["saas","api","lifecycle","drift","feedback"]
---

## Objetivo
Gate: correcciones de la revisión de seguridad (IDOR, alcance de RLS de las rutas nuevas, límites de tasa donde falten, cobertura de auditoría)

## Contexto
SDD-012 — API de backend para el frontend de Centurion Factory: estaciones, agregados, órdenes, feedback y baseline de código; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-012
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-344`
