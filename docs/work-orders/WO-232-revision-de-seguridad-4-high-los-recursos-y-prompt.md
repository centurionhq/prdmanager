---
id: "WO-232"
type: "WO"
title: "Revisión de seguridad #4 (HIGH): los recursos y prompts del MCP remoto (resources/read, prompts/get) no pasan por instrumentToolCalls y quedan sin scope, sin auditoría y sin rate limit; envolver registerResource/registerPrompt igual que registerTool, con test de que un token sin mcp:read es rechazad"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "cb47110850c58993"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T02:39:12.075Z"
completed_at: "2026-09-15T02:50:13.021Z"
resolved_by: ["8a51fd9ed7cf9f0e3e6f235a6bca3dcf39c504ea"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
Revisión de seguridad #4 (HIGH): los recursos y prompts del MCP remoto (resources/read, prompts/get) no pasan por instrumentToolCalls y quedan sin scope, sin auditoría y sin rate limit; envolver registerResource/registerPrompt igual que registerTool, con test de que un token sin mcp:read es rechazado y de que cada llamada se audita

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-232`
