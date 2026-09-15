---
id: "WO-385"
type: "WO"
title: "E2E: una edición en Vista previa deja el resto del archivo idéntico en Markdown, un segundo usuario la ve, el blame la atribuye, cero violaciones de CSP"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-014"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "a75a5ae2caacc10a"
tags: ["editor","collab","yjs","accessibility"]
---

## Objetivo
E2E: una edición en Vista previa deja el resto del archivo idéntico en Markdown, un segundo usuario la ve, el blame la atribuye, cero violaciones de CSP

## Contexto
SDD-014 — Editor de vista previa sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-014
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-385`
