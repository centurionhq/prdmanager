---
id: "FB-009"
type: "FB"
title: "`prdm link --import` no puede completarse cuando el repo ya tiene un `.prdm.yaml` local (v1)"
status: "triaged"
created_at: "2026-09-16"
source: "chat"
informs: ["PRD-007"]
---

**Resuelto por WO-391** (`fix(FB-009): let \`prdm link --import\` migrate a repo that already has a local .prdm.yaml`): `planLink` ahora acepta un `.prdm.yaml` local existente cuando `importing: true`, con test de cobertura en `scaffold-link.test.ts` y `link.test.ts`.


## Feedback

Durante el dogfooding de WO-372 (PRD-007), intenté correr el flujo real de `prdm link <org>/<project> --server ... --import` contra una copia de este mismo repositorio (con su `docs/`, `.prdm.yaml` v1 y `.prdm/baseline.json` reales) apuntando a una instancia SaaS local recién creada.

**Reproducción:**
1. `prdm login --server http://127.0.0.1:4601` (token personal con scope `import:write`).
2. `prdm link acme/proyecto --server http://127.0.0.1:4601 --import` sobre un repo cuyo `.prdm.yaml` es actualmente `version: 1` (local) con `docs/` reales.
3. Falla siempre con: `.prdm.yaml already exists as a local (version 1) project; remove it first if you really want to link this repository to a remote project`.
4. Si se borra `.prdm.yaml` antes (para "arreglar" el error anterior), entonces `--import` falla con el error opuesto: `.prdm.yaml not found; this repository has no local project to import`.

**Causa raíz (confirmada en código):** `packages/cli/src/remote/link.ts`'s `runLink` llama `readLocalImportPayload(root)` (que EXIGE que `.prdm.yaml` exista como v1) y luego `planLink(root, ...)` (que RECHAZA si `.prdm.yaml` ya existe como v1, vía `AlreadyLocalProjectError` en `packages/core/src/scaffold/link.ts`). No hay ningún paso intermedio que borre o transforme `.prdm.yaml` entre ambas llamadas dentro de la misma invocación — por lo tanto `prdm link --import` es estructuralmente imposible de completar contra CUALQUIER repositorio que ya tenga un proyecto local v1 real, que es precisamente el caso de uso principal que `--import` dice resolver ("adoptar un repo prdm local existente a un proyecto SaaS").

**Por qué el test suite no lo detectó:** `packages/cli/tests/unit/link.test.ts`'s único test para `--import` ("--import reads the local .prdm.yaml before it gets overwritten...") usa un fixture SIN `.prdm.yaml` en absoluto, y solo verifica el mensaje de error correcto para ESE caso. El test de integración `packages/cli/tests/integration/import-round-trip.test.ts` (el que sí corre contra los docs reales de este repo) deliberadamente llama a `readLocalImportPayload` + `uploadImportPayload` directamente, NUNCA a `runLink`/`planLink` — el propio comentario del test cita SDD-010: "El dogfooding sobre este repo no commitea remote", así que ese test nunca ejercita el camino completo del comando `prdm link --import` real. No existe ningún test que cubra `--import` con un `.prdm.yaml` v1 real presente.

**Impacto:** cualquier operador que siga la guía del propio README (sección "Login y vinculación") para migrar un repo prdm local existente a una organización SaaS con `--import` se encuentra con un error sin salida posible vía la CLI documentada.

**Sugerencia (no vinculante):** o bien `runLink` debería, cuando `options.import` es `true`, tolerar (o incluso requerir) que `.prdm.yaml` exista como v1 y saltear el chequeo de `AlreadyLocalProjectError` específicamente en ese caso (ya que el propósito explícito de `--import` es justo migrar un proyecto local existente), o bien el mensaje de error debería guiar al operador hacia el flujo real soportado.
