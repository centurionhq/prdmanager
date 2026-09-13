---
id: "WO-013"
type: "WO"
title: "AuthoringService con DraftSession en memoria, reserva de IDs, validación en vivo y commit atómico journaled"
status: "todo"
created_at: "2026-09-13"
implements: ["SDD-002"]
governs: ["packages/core/src/**","packages/cli/src/**","packages/mcp/src/**"]
source_task: "86e28e3a93d5cfce"
tags: ["architecture","multi-project","headless","authoring","mcp","neo4j"]
---

## Objetivo
AuthoringService con DraftSession en memoria, reserva de IDs, validación en vivo y commit atómico journaled

## Contexto
SDD-002 — Motor headless multi-proyecto con autoría conversacional; features: PRD-002

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-002
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-013`
