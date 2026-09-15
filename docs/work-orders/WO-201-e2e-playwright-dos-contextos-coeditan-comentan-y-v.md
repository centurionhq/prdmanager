---
id: "WO-201"
type: "WO"
title: "E2E Playwright: dos contextos coeditan, comentan y ven blame, el agente con LLM falso propone y se acepta, el admin publica PRD y SDD, se generan WOs y un cliente MCP reclama y completa un WO tras un reporte de CI con OIDC de prueba"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "62615c5efcdda181"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T05:28:26.844Z"
completed_at: "2026-09-15T05:29:53.797Z"
resolved_by: ["46340f398db4c2e77d30c25237897f98e1681b45"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
E2E Playwright: dos contextos coeditan, comentan y ven blame, el agente con LLM falso propone y se acepta, el admin publica PRD y SDD, se generan WOs y un cliente MCP reclama y completa un WO tras un reporte de CI con OIDC de prueba

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-201`
