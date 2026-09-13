---
id: "WO-150"
type: "WO"
title: "Vinculación de client id en beforeSync antes de aplicar con aceptación de structs contenidos en el state vector del servidor, rechazo de pendingStructs y de delete sets desconocidos, cierre de conexión y client id nuevo por transacción de servidor, con tests de cliente malicioso y de reinicio"
status: "pending"
created_at: "2026-09-13"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "de223a3fb8dcc263"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Vinculación de client id en beforeSync antes de aplicar con aceptación de structs contenidos en el state vector del servidor, rechazo de pendingStructs y de delete sets desconocidos, cierre de conexión y client id nuevo por transacción de servidor, con tests de cliente malicioso y de reinicio

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-150`
