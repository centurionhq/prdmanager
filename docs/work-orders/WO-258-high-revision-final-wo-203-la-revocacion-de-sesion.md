---
id: "WO-258"
type: "WO"
title: "HIGH — revisión final WO-203: la revocación de sesión (databaseHooks.session.delete.after → collabRevocationHub.revokeUser) solo cierra websockets de /collab; el SSE del agente (documents-agent.ts) solo valida la sesión una vez al iniciar el turno y luego deshabilita el timeout de request (puede dur"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "5c69a42e7883bfa9"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:10.633Z"
completed_at: "2026-09-15T10:48:57.449Z"
resolved_by: ["e4cf3f03fd203367c8c8bbd07aef9bbd6fe6e075"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
HIGH — revisión final WO-203: la revocación de sesión (databaseHooks.session.delete.after → collabRevocationHub.revokeUser) solo cierra websockets de /collab; el SSE del agente (documents-agent.ts) solo valida la sesión una vez al iniciar el turno y luego deshabilita el timeout de request (puede durar minutos), sin volver a chequear validez de sesión en cada tool call — solo re-chequea rol/membership. Agregar un chequeo de sesión vigente en cada iteración del loop del agente (o suscribir el stream a la misma revocationHub), con test de una sesión revocada a mitad de turno

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-258`
