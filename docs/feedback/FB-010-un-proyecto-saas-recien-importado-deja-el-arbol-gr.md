---
id: "FB-010"
type: "FB"
title: "Un proyecto SaaS recién importado deja el Árbol (graph/tree) completamente vacío hasta el primer reporte de CI baseline, sin ningún aviso"
status: "new"
created_at: "2026-09-16"
source: "chat"
informs: ["PRD-007"]
---

## Feedback

Durante el dogfooding de WO-372 (PRD-007), después de importar este mismo repositorio completo (431 documentos, vía `readLocalImportPayload`/`uploadImportPayload`, el mismo camino de `packages/cli/tests/integration/import-round-trip.test.ts`) a un proyecto SaaS local recién creado:

- `GET .../line-board` (Planta) funciona correctamente de inmediato: refleja las estaciones reales de cada feature (por ejemplo PRD-007 en "ejecucion", 68/69 WOs done) — coincide con lo que muestra `prdm tree` localmente.
- `GET .../inbox` (Entrada) también funciona de inmediato (11 items).
- Pero `GET .../graph/full` devuelve `{"nodes":[],"edges":[]}` y `GET .../graph/node/PRD-007` devuelve `404 not found` — el Árbol queda **completamente vacío**, a pesar de que los 431 documentos y todas sus relaciones (`evolves_from`, `implements`, `informs`, etc.) están perfectamente presentes en Postgres (se ve en `line-board` y en `drift/issues`, que sí reflejan la jerarquía real).

**Causa probable:** `graph/full`/`graph/node`/`graph/tree` (`packages/server/src/api/graph.ts`) leen de un `GraphStore` respaldado por Neo4j vía `resolvePgProjectEngine(...).store`, y ese grafo en Neo4j solo se proyecta (`buildSnapshot`, CodeRef/GOVERNED_BY incluidos) como efecto de un reporte de CI baseline — exactamente la mecánica que WO-334 corrigió esta sesión (`buildDriftInput`/`reconcileBaseline`). Un import de documentos por sí solo nunca dispara esa proyección a Neo4j.

Esto ya estaba parcialmente anticipado en el plan de PRD-007 bajo "Dogfood limit" ("no hay OIDC de GitHub local, así que no hay reportes baseline ni code refs en el dogfooding local... las estaciones igual funcionan desde los documentos"), pero la nota subestima el alcance real: no es solo que falten code refs — la pantalla Árbol completa (toda la jerarquía de features/blueprints/WOs, sin ningún code ref de por medio) queda inutilizable, y no hay ningún banner/mensaje en la API ni (presumiblemente) en la UI que le explique a un operador recién onboardeado por qué ve un árbol vacío justo después de haber importado con éxito 431 documentos.

**Impacto:** cualquier organización que adopte prdm SaaS importando un repo existente (el camino de onboarding más natural) va a ver Planta y Entrada funcionando pero el Árbol completamente vacío hasta correr al menos un CI real — una experiencia de primer uso confusa sin explicación visible.

**Sugerencia (no vinculante):** o bien poblar el grafo de Neo4j como parte del propio endpoint de import (no solo Postgres), o al menos mostrar un estado vacío explicativo en el Árbol ("todavía no hay un reporte de CI; el árbol se completa después del primer reporte baseline") en vez de una lista vacía sin contexto.
