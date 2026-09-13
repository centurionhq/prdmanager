---
id: "WO-049"
type: "WO"
title: "Endpoint GET /api/search con labels csv validadas y limit acotado, y sus tests"
status: "done"
created_at: "2026-09-13"
implements: ["SDD-005"]
impacts_paths: ["packages/web/src/**","packages/web/tests/**","packages/web/package.json","packages/web/tsconfig*.json","packages/web/vite.config.ts","packages/web/playwright.config.ts","packages/web/index.html","package.json","package-lock.json","tsconfig.json","tsconfig.base.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md",".github/workflows/prdm-sync.yml",".gitignore","packages/testkit/src/**"]
source_task: "a43704fde54a8abe"
tags: ["web-ui","fastify","react","cytoscape","dogfooding"]
assigned_to: "agent:claude"
claimed_at: "2026-09-13T17:39:32.441Z"
completed_at: "2026-09-13T17:40:29.351Z"
resolved_by: ["9903f214a0a93059239ddd5456704f0752add45d"]
blueprint_hashes: {"SDD-005":"40ffb5aa0ac24b9f000c7583fae084fe23ab3990053927e75e87ed56011b93bd"}
---

## Objetivo
Endpoint GET /api/search con labels csv validadas y limit acotado, y sus tests

## Contexto
SDD-005 — Explorador web: backend Fastify de solo lectura y SPA React con Cytoscape; features: PRD-004

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-049`
