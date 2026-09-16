---
id: "WO-383"
type: "WO"
title: "Conectar `PreviewEditor` como la pestaña \"Vista previa\" por defecto de Documento, reemplazando el `MarkdownPreview` puente de SDD-013"
status: "done"
created_at: "2026-09-15"
implements: ["SDD-014"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "686040f366a3ec5b"
tags: ["editor","collab","yjs","accessibility"]
assigned_to: "agent:claude"
claimed_at: "2026-09-16T02:30:20.797Z"
completed_at: "2026-09-16T03:16:35.615Z"
resolved_by: ["a7476ac026557da896ef5b9794c8171d7165025a"]
blueprint_hashes: {"SDD-014":"aa6eba6d8fecb8f4f2b1453724b6f1df520bd39267debdce18896734e6fd7291"}
---

## Objetivo
Conectar `PreviewEditor` como la pestaña "Vista previa" por defecto de Documento, reemplazando el `MarkdownPreview` puente de SDD-013

## Contexto
SDD-014 — Editor de vista previa sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-014
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-383`
