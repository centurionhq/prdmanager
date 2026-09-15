---
id: "WO-357"
type: "WO"
title: "Documento: encabezado, acciones de flujo, pantalla de revisión de publicación, reintento de generación de órdenes"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-013"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
source_task: "e19dda31ff461d1a"
tags: ["saas","frontend","design","canvas","e2e"]
---

## Objetivo
Documento: encabezado, acciones de flujo, pantalla de revisión de publicación, reintento de generación de órdenes

## Contexto
SDD-013 — Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-013
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-357`
