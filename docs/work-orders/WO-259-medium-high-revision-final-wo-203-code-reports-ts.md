---
id: "WO-259"
type: "WO"
title: "MEDIUM/HIGH — revisión final WO-203: code-reports.ts e import.ts no tienen rate limit (@fastify/rate-limit está registrado con global:false y ninguna de las dos rutas se suma), y el modo baseline de code-reports dispara PgProjectEngine.refresh() (proyección completa contra el único Neo4j compartido)"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "64295eec74be6c2e"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:12.788Z"
completed_at: "2026-09-15T10:45:37.062Z"
resolved_by: ["cecbb959bacbe7a9515c8fdc88fabb0c3cc74cb6"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
MEDIUM/HIGH — revisión final WO-203: code-reports.ts e import.ts no tienen rate limit (@fastify/rate-limit está registrado con global:false y ninguna de las dos rutas se suma), y el modo baseline de code-reports dispara PgProjectEngine.refresh() (proyección completa contra el único Neo4j compartido) — agregar el mismo patrón de rate limit ya usado por auth/comments/agent/mcp-remote a ambas rutas, con test

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-259`
