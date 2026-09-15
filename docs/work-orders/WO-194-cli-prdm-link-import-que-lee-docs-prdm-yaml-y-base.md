---
id: "WO-194"
type: "WO"
title: "CLI prdm link --import que lee docs, .prdm.yaml y baseline locales, valida y sube con resumen, con test de ida y vuelta de contentHash sobre los documentos de este repositorio"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "ebcf9e7aa8bea233"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T01:18:50.764Z"
completed_at: "2026-09-15T01:26:13.133Z"
resolved_by: ["aedaebd003037d5f47956b47a06b10548cf21be3"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
CLI prdm link --import que lee docs, .prdm.yaml y baseline locales, valida y sube con resumen, con test de ida y vuelta de contentHash sobre los documentos de este repositorio

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-194`
