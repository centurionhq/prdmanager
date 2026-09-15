---
id: "WO-261"
type: "WO"
title: "HIGH (rendimiento) — revisión final WO-203: POST .../code-reports (code-reports.ts) recarga y reparsea el set completo de documentos publicados (listPublished + scanContents) en cada reporte, sea baseline o preview, en vez de cachear la representación escaneada por graph_version como ya hace governa"
status: "in_progress"
created_at: "2026-09-15"
implements: ["SDD-010"]
impacts_paths: ["packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/mcp/src/**","packages/cli/src/**","packages/cli/tests/**","packages/cli/package.json","packages/core/src/**","packages/contracts/src/**","packages/contracts/tests/**","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.config.ts","packages/testkit/src/**",".github/workflows/prdm-sync.yml",".gitignore","vitest.config.ts","README.md",".env.example","package.json","package-lock.json"]
source_task: "9ff416ecfcc5f2a1"
tags: ["saas","remote-mcp","sync","drift","cli","import","oidc"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T10:13:17.287Z"
---

## Objetivo
HIGH (rendimiento) — revisión final WO-203: POST .../code-reports (code-reports.ts) recarga y reparsea el set completo de documentos publicados (listPublished + scanContents) en cada reporte, sea baseline o preview, en vez de cachear la representación escaneada por graph_version como ya hace governance.ts con su ETag; agregar ese cacheo con test de que un segundo reporte con el mismo graph_version no vuelve a escanear

## Contexto
SDD-010 — MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-010
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-261`
