---
id: "WO-244"
type: "WO"
title: "WO-242 diagnosticó mal el deadlock de truncateAll (packages/testkit/src/pg.ts) contra live-validation.test.ts: asumió que las relaciones en conflicto (OIDs 17071/16935) eran doc_updates/doc_client_bindings y \"arregló\" solo el orden de esas dos, pero el mismo deadlock (mismos OIDs) volvió a reproduci"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "9a921d8583e59b5d"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T08:37:02.213Z"
completed_at: "2026-09-15T08:44:49.903Z"
resolved_by: ["d251075315bc4a4f0e3d4f64647a8f7083dea628"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
WO-242 diagnosticó mal el deadlock de truncateAll (packages/testkit/src/pg.ts) contra live-validation.test.ts: asumió que las relaciones en conflicto (OIDs 17071/16935) eran doc_updates/doc_client_bindings y "arregló" solo el orden de esas dos, pero el mismo deadlock (mismos OIDs) volvió a reproducirse en la siguiente corrida real de CI; los OIDs reales son documents (16935) y doc_updates (17071) — doc_client_bindings no participa. Re-diagnosticar desde cero cuál transacción de la app toca ambas tablas en orden opuesto al de truncateAll (candidato: persistence.ts's onStoreDocument, que hace SELECT doc_updates y luego UPDATE documents) y corregir el orden real de adquisición de locks, con verificación bajo carga inducida (no solo "corrió una vez")

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-244`
