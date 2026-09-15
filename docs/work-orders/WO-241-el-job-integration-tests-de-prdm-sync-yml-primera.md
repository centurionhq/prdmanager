---
id: "WO-241"
type: "WO"
title: "El job integration-tests de prdm-sync.yml (primera corrida real) falló en dos suites pre-existentes que ninguna corría en CI hasta ahora: packages/cli/tests/e2e/isolation-and-authoring.test.ts lee NEO4J_PASSWORD de un .env que no existe en el runner, y packages/server/tests/integration/password-rese"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "0ea274bd8b5111bd"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
---

## Objetivo
El job integration-tests de prdm-sync.yml (primera corrida real) falló en dos suites pre-existentes que ninguna corría en CI hasta ahora: packages/cli/tests/e2e/isolation-and-authoring.test.ts lee NEO4J_PASSWORD de un .env que no existe en el runner, y packages/server/tests/integration/password-reset.test.ts necesita un SMTP real (mailpit) que el job no levanta; escribir un .env mínimo en el job y agregar el servicio mailpit, con la corrida de CI en verde como criterio de aceptación

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-241`
