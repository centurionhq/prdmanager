---
id: "WO-189"
type: "WO"
title: "CLI prdm mcp-proxy stdio desde la instalación de usuario que reenvía al MCP remoto solo con la credencial del origin exacto y el proyecto fijado al hacer link, y aborta si .prdm.yaml apunta a otro servidor o proyecto, con tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "aa3f22706f47381c"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T00:41:53.366Z"
completed_at: "2026-09-15T00:45:01.249Z"
resolved_by: ["cf16b6c7b3f3c0a964f5456169b402e1b4f84473"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
CLI prdm mcp-proxy stdio desde la instalación de usuario que reenvía al MCP remoto solo con la credencial del origin exacto y el proyecto fijado al hacer link, y aborta si .prdm.yaml apunta a otro servidor o proyecto, con tests

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-189`
