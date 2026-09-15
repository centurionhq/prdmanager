---
id: "WO-236"
type: "WO"
title: "Revisión de seguridad #4 (MEDIUM): pasar redirect: 'error' también en la construcción de StreamableHTTPClientTransport (mcp-client.ts y mcp-proxy.ts), no solo en los fetches de login/sync/import, con test de un servidor que redirige"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "2f8bf9d60d80a38a"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
---

## Objetivo
Revisión de seguridad #4 (MEDIUM): pasar redirect: 'error' también en la construcción de StreamableHTTPClientTransport (mcp-client.ts y mcp-proxy.ts), no solo en los fetches de login/sync/import, con test de un servidor que redirige

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-236`
