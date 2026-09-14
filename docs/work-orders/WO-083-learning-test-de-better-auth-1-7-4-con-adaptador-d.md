---
id: "WO-083"
type: "WO"
title: "Learning test de better-auth 1.7.4 con adaptador drizzle y esquema propio descartable: allowlist de endpoints, sign-up público y allowUserToCreateOrganization deshabilitados, superadmin que crea organización e invita a su owner, baseURL fijo e identificadores de verificación hasheados, sobre el Post"
status: "done"
created_at: "2026-09-13"
implements: ["ADR-006"]
impacts_paths: ["packages/server/tests/learning/**","packages/server/scripts/**","packages/server/*.json","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts"]
source_task: "ee6b10f106b3ed83"
tags: ["architecture-decision","saas","stack"]
assigned_to: "agent:claude"
claimed_at: "2026-09-14T00:28:52.725Z"
completed_at: "2026-09-14T00:41:05.625Z"
resolved_by: ["ce3a102e6fc1ec616dd3df1696ef7daf43c51051"]
blueprint_hashes: {"ADR-006":"7c1798b97241b0318880738cb1f647c68c428180087c9de14fbd36f295505f57"}
---

## Objetivo
Learning test de better-auth 1.7.4 con adaptador drizzle y esquema propio descartable: allowlist de endpoints, sign-up público y allowUserToCreateOrganization deshabilitados, superadmin que crea organización e invita a su owner, baseURL fijo e identificadores de verificación hasheados, sobre el Postgres de test

## Contexto
ADR-006 — Stack de la plataforma SaaS: Postgres + better-auth + Hocuspocus/Yjs + CodeMirror + DeepSeek; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-006
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-083`
