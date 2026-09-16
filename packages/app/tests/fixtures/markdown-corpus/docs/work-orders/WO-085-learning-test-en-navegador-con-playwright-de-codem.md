---
id: "WO-085"
type: "WO"
title: "Learning test en navegador con Playwright de CodeMirror 6 con y-codemirror.next y de Cytoscape bajo una CSP con nonce de estilo y sin 'unsafe-inline', que documenta si hace falta otra estrategia de estilos"
status: "done"
created_at: "2026-09-13"
implements: ["ADR-006"]
impacts_paths: ["packages/server/tests/learning/**","packages/server/scripts/**","packages/server/*.json","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts"]
source_task: "03e1987adee0864e"
tags: ["architecture-decision","saas","stack"]
assigned_to: "agent:claude"
claimed_at: "2026-09-15T09:45:41.360Z"
completed_at: "2026-09-15T09:53:36.078Z"
resolved_by: ["3f63e54a2e5f92dc03eb129486c42ae0fda9df01"]
blueprint_hashes: {"ADR-006":"7c1798b97241b0318880738cb1f647c68c428180087c9de14fbd36f295505f57"}
---

## Objetivo
Learning test en navegador con Playwright de CodeMirror 6 con y-codemirror.next y de Cytoscape bajo una CSP con nonce de estilo y sin 'unsafe-inline', que documenta si hace falta otra estrategia de estilos

## Contexto
ADR-006 — Stack de la plataforma SaaS: Postgres + better-auth + Hocuspocus/Yjs + CodeMirror + DeepSeek; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-085`
