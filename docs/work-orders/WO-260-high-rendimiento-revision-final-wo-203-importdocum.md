---
id: "WO-260"
type: "WO"
title: "HIGH (rendimiento) — revisión final WO-203: importDocuments (packages/db/src/import-repository.ts) hace un INSERT/UPDATE secuencial por documento (y por versión, y por commit) dentro de una única transacción con pg_advisory_xact_lock, sosteniendo una conexión del pool compartido durante cientos de r"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "abe97b8d03cb03d4"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:15.168Z"
completed_at: "2026-09-15T10:48:43.079Z"
resolved_by: ["b9d0be91a73c17392d9f181b1be6364c953e7c26"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
HIGH (rendimiento) — revisión final WO-203: importDocuments (packages/db/src/import-repository.ts) hace un INSERT/UPDATE secuencial por documento (y por versión, y por commit) dentro de una única transacción con pg_advisory_xact_lock, sosteniendo una conexión del pool compartido durante cientos de round-trips en un repo mediano (este repo: 260 documentos); reescribir como inserts en lote (.values([...])) para documents, document_versions y commits, con test de que el número de round-trips no escala linealmente con la cantidad de documentos

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-260`
