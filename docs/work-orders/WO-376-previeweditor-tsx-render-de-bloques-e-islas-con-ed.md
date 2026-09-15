---
id: "WO-376"
type: "WO"
title: "`PreviewEditor.tsx`: render de bloques e islas, con \"Editar en Markdown\" ubicando el cursor de CodeMirror en la posición correcta"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-014"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
source_task: "47dfa8e6c4f709df"
tags: ["editor","collab","yjs","accessibility"]
---

## Objetivo
`PreviewEditor.tsx`: render de bloques e islas, con "Editar en Markdown" ubicando el cursor de CodeMirror en la posición correcta

## Contexto
SDD-014 — Editor de vista previa sin pérdida sobre Y.Text; features: PRD-007

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-014
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-376`
