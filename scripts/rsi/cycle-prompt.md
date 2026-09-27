<!--
WO-589 / SDD-057: the prompt `scripts/rsi/driver.mjs` feeds to each headless `claude -p` invocation, one
per RSI cycle. `CLAUDE.md`'s "Loop de auto-mejora (RSI)" section is loaded automatically as project
instructions in every session in this repo, so it is not repeated here — this file only sequences one
cycle and defines the machine-readable outcome the driver parses (`driver-lib.mjs#parseCycleOutcome`).
-->

Ejecutá exactamente UN ciclo del loop de auto-mejora (RSI), siguiendo el pipeline y las guardas de la
sección "Loop de auto-mejora (RSI)" de `CLAUDE.md`. No repitas ciclos dentro de esta misma invocación —
`scripts/rsi/driver.mjs` es quien decide cuándo lanzar el próximo.

## Pasos

1. **Sense**: `get_metrics`, `get_drift_report`, `get_feature_tree(format:'json')`.
2. **Ideate**, en este orden fijo, usando la primera opción que aplique:
   a. Un `FB` con `status: new` sin triar → `triage_feedback`.
   b. Un `FR` con `status: proposed` que aún no tiene blueprint.
   c. Un issue de `get_drift_report` auto-sanable (doc stale, link roto) con un fix mecánico claro.
   d. Si ninguna de las anteriores aplica → invocá el agente `rsi-ideation` para proponer una `FR`
      especulativa nueva, anclada con `justified_by` real.
3. **Plan**: si corresponde, redactá/actualizá el blueprint (SDD/ADR) con un checklist `## Tareas` real
   (agente `planner`), o `add_blueprint_task` para el caso (c).
4. **Generate WOs**: `generate_work_orders(blueprint_id)`.
5. **Claim**: `claim_work_order(id, assignee: 'agent:rsi-loop')`.
6. **Implement**: pipeline existente — `planner` → `tdd-guide` (RED/GREEN/REFACTOR) → `code-reviewer`
   (siempre) → `security-reviewer` (si el WO toca auth/pagos/datos de usuario/BD/APIs externas/cripto).
7. **Commit**: trailers `Refs: WO-xxx` + `Co-Authored-By`. Los hooks (`pre-commit`/`pre-push`) deben correr
   de verdad — nunca `--no-verify` ni `PRDM_SKIP_HOOKS`.
8. **Push** a `main`.
9. **Esperar CI**: `gh run watch` sobre el último run de `prdm-sync.yml` en `main`. Si Actions está
   caído/rate-limited, reintentá con backoff — no lo cuentes como fallo de ciclo.
10. **Deploy**: `node packages/server/scripts/deploy.mjs`.
11. **Smoke-check**: `node packages/server/scripts/smoke-check.mjs`.
    - Éxito → seguí al paso 12.
    - Fallo → `node packages/server/scripts/rollback.mjs <sha>`, luego smoke-check de nuevo.
      - Si el rollback también falla el smoke-check, marcá `rollbackFailed: true` en el resultado y
        parate ahí — no sigas intentando.
12. **Complete**: `complete_work_order(id, commit_sha)`.

Si en el paso 2 no hay absolutamente nada que hacer (sin FB/FR/drift, y `rsi-ideation` tampoco encuentra
una idea justificable), no inventes trabajo: terminá el ciclo como `idle`.

## Resultado

Terminá tu respuesta con exactamente este bloque (una sola vez, al final), reemplazando los valores:

```
<<<RSI_CYCLE_OUTCOME>>>
{"outcome": "implemented" | "idle" | "failed", "workOrderId": "WO-xxx" | null, "backlogRemaining": true | false, "rollbackFailed": true | false}
<<<END>>>
```

- `outcome: "implemented"` sólo si llegaste al paso 12 (`complete_work_order`) con éxito.
- `outcome: "idle"` sólo si el paso 2 no encontró nada que hacer.
- `outcome: "failed"` para cualquier otro caso (hook que no pasa, deploy que no levanta, CI que rechaza el
  commit, etc.) — describí la causa en tu respuesta, antes del bloque.
- `backlogRemaining: true` si `get_feature_tree`/`list_work_orders` todavía muestra FB/FR/WO pendientes
  después de este ciclo (el próximo ciclo debería arrancar pronto); `false` si no queda nada visible.
- `rollbackFailed: true` sólo en el caso descripto en el paso 11.
