---
id: "WO-257"
type: "WO"
title: "CRÍTICO — revisión final WO-203: un token personal (POST /api/app/tokens) se emite sin validar que quien lo crea sea realmente miembro de cada projectId listado (assertProjectIdsBelongToOrg solo valida que el proyecto pertenezca a la org, no la membresía del creador), y governance.ts/policy-docs.ts/"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "37cef62242499177"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:08.494Z"
completed_at: "2026-09-15T10:45:34.797Z"
resolved_by: ["cecbb959bacbe7a9515c8fdc88fabb0c3cc74cb6"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
CRÍTICO — revisión final WO-203: un token personal (POST /api/app/tokens) se emite sin validar que quien lo crea sea realmente miembro de cada projectId listado (assertProjectIdsBelongToOrg solo valida que el proyecto pertenezca a la org, no la membresía del creador), y governance.ts/policy-docs.ts/code-reports.ts confían únicamente en el scoping guardado del token (sin resolveProjectSubject/findMembership como sí hacen mcp-remote.ts e import.ts) devolviendo published_raw completo; además ningún flujo de baja de miembro (organizations.ts, projects.ts) revoca tokens personales existentes. Corregir: validar projectIds contra la membresía real del emisor al crear, exigir rol admin de org para tokens sin projectIds con scopes governance:read/reports:write, agregar el mismo chequeo de rol en vivo que mcp-remote.ts/import.ts a las tres rutas, y revocar tokens del usuario removido, con tests

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-257`
