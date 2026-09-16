---
id: "WO-391"
type: "WO"
title: "FB-009 (encontrado dogfoodeando PRD-007): `prdm link <org>/<project> --import` no puede completarse nunca contra un repo que ya tiene un `.prdm.yaml` local real en `version: 1` — que es justo su caso de uso principal. `runLink` (packages/cli/src/remote/link.ts) lee el payload de import antes de llam"
status: "done"
created_at: "2026-09-16"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "3d2b069d274640a4"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T12:41:15.993Z"
completed_at: "2026-09-16T12:49:48.117Z"
resolved_by: ["045f60026230d3a50cb2b23276e87980c3a4cf5c"]
blueprint_hashes: {"SDD-010":"a40225b83b2e4989ac23e7ba309a3abafe0491bdaf5ebdbdc7802d034f80760a"}
---

## Objetivo
FB-009 (encontrado dogfoodeando PRD-007): `prdm link <org>/<project> --import` no puede completarse nunca contra un repo que ya tiene un `.prdm.yaml` local real en `version: 1` — que es justo su caso de uso principal. `runLink` (packages/cli/src/remote/link.ts) lee el payload de import antes de llamar a `planLink`, pero `planLink` (packages/core/src/scaffold/link.ts) rechaza incondicionalmente si ya existe un `.prdm.yaml` local, sin ninguna combinación de flags que deje pasar ambas cosas. Agregar `importing?: boolean` a `PlanLinkInput` y solo tirar `AlreadyLocalProjectError` cuando `!input.importing`; pasar `importing: options.import` desde `runLink`. Cubrir con un test en `packages/core/tests/unit/scaffold-link.test.ts` (planLink no tira con `importing: true` sobre un `.prdm.yaml` v1 real) y otro en `packages/cli/tests/unit/link.test.ts` (runLink con `import: true` completa contra un fixture con `.prdm.yaml` v1 real y sube el payload correcto)

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-391`
