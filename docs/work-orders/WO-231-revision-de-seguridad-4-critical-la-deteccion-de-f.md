---
id: "WO-231"
type: "WO"
title: "Revisión de seguridad #4 (CRITICAL): la detección de force-push/reescritura de historia depende del array commits[] declarado por el cliente en vez de verificar la ascendencia real; corroborar de forma independiente (API de GitHub con el token de instalación verificado por OIDC, o una prueba de cade"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "c299d17132399725"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T02:32:44.283Z"
completed_at: "2026-09-15T02:38:48.074Z"
resolved_by: ["d7b8fb12c19312b872babc9ecbd0748f79abb7f7"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Revisión de seguridad #4 (CRITICAL): la detección de force-push/reescritura de historia depende del array commits[] declarado por el cliente en vez de verificar la ascendencia real; corroborar de forma independiente (API de GitHub con el token de instalación verificado por OIDC, o una prueba de cadena de padres) en vez de confiar en la membresía del array reportado, con test de un head_sha reescrito que incluye el head anterior de forma fabricada

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-231`
