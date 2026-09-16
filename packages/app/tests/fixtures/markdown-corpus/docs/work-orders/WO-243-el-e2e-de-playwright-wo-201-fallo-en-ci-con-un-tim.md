---
id: "WO-243"
type: "WO"
title: "El E2E de Playwright (WO-201) falló en CI con un timeout de 30s esperando que el campo \"Justificado por\" refleje \"FB-001\" tras la sincronización entre clientes; diagnosticar si es una condición de carrera real de sync entre clientes bajo el runner más lento o un problema del propio test, con espera "
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "27db9e436256ee8a"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T07:34:46.110Z"
completed_at: "2026-09-15T07:40:17.202Z"
resolved_by: ["17004c49fcd05329c84445a5f035ab6012c1fafc"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
El E2E de Playwright (WO-201) falló en CI con un timeout de 30s esperando que el campo "Justificado por" refleje "FB-001" tras la sincronización entre clientes; diagnosticar si es una condición de carrera real de sync entre clientes bajo el runner más lento o un problema del propio test, con espera basada en el evento real de sincronización si hace falta, nunca un timeout más largo como único fix

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-243`
