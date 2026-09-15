---
id: "WO-233"
type: "WO"
title: "Revisión de seguridad #4 (HIGH): el registro de baseline hace la verificación de idempotencia después de los efectos (upsert de commits, refresh del engine) y la actualización de impacts_hashes es un read-modify-write sin lock, permitiendo un lost-update entre dos reportes de baseline concurrentes d"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "e7229f9c8d2335d7"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
---

## Objetivo
Revisión de seguridad #4 (HIGH): el registro de baseline hace la verificación de idempotencia después de los efectos (upsert de commits, refresh del engine) y la actualización de impacts_hashes es un read-modify-write sin lock, permitiendo un lost-update entre dos reportes de baseline concurrentes distintos; serializar con el mismo advisory lock de refresh() y mover la verificación de idempotencia antes de cualquier efecto, con test de concurrencia real

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-233`
