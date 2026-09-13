---
id: "FB-002"
type: "FB"
title: "Decisiones del usuario para PRD-002: monorepo, renombres con alias y Refs en código gobernado"
status: "triaged"
created_at: "2026-09-13"
source: "chat"
informs: ["PRD-002"]
---

## Feedback

Pedido: "Haz un plan usando los subagentes expertos y skills para llevar a la realidad el PRD-002".

Decisiones tomadas por el usuario durante la planificación:

1. **Headless Core:** `@prdm/core` se empaqueta como monorepo con npm workspaces (`packages/core`, `packages/cli`, `packages/mcp`), para que una futura Web UI pueda importar el core.
2. **Renombres:** `impacts_paths` y el estado de WO `pending` son canónicos; `governs` y `todo` se aceptan como alias deprecados con warning, y `prdm migrate docs` reescribe los documentos y el baseline existentes.
3. **Trailer `Refs: WO-XXX`:** obligatorio solo en commits que tocan código gobernado; se aplica con un hook `commit-msg` y un chequeo en CI. Los commits de documentación quedan libres.
4. Mantener el stack explícito con versiones exactas, servicios locales reales y ejecución con subagentes expertos y skills de Neo4j.
