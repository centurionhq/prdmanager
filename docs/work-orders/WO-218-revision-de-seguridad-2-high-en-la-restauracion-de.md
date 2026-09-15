---
id: "WO-218"
type: "WO"
title: "Revisión de seguridad #2 (HIGH): en la restauración de versión, escribir de forma durable doc_updates y doc_client_bindings antes de aplicar la transacción en el Y.Doc en vivo y difundirla (hoy ocurre al revés, dejando una ventana sin fila de atribución si el proceso cae entre ambos pasos), con test"
status: "done"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "47f3aebe6dae8f92"
tags: ["saas","realtime","yjs","blame","comments","versions"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T16:55:34.844Z"
completed_at: "2026-09-14T17:09:50.944Z"
resolved_by: ["70a5a09df8c31838703cb9d1436c17758c3c28b4"]
blueprint_hashes: {"SDD-008":"7cd57f8db0d39dba7c4dd43c5994c3149c3a7a0a5e1187b1f0946722c1da2765"}
---

## Objetivo
Revisión de seguridad #2 (HIGH): en la restauración de versión, escribir de forma durable doc_updates y doc_client_bindings antes de aplicar la transacción en el Y.Doc en vivo y difundirla (hoy ocurre al revés, dejando una ventana sin fila de atribución si el proceso cae entre ambos pasos), con test de la condición de carrera entre una restauración y una edición concurrente del mismo documento

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-218`
