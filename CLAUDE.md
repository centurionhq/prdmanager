# CLAUDE.md

## Loop de auto-mejora (RSI)

Esta sección gobierna las corridas headless de `scripts/rsi/driver.mjs` (`claude -p --settings
.claude/settings.rsi.json`, una por ciclo, ver `scripts/rsi/cycle-prompt.md`). PRD-039 / SDD-057 tiene el
diseño completo; esto es el resumen operativo que cada ciclo debe respetar.

### Orden de prioridad de ideación

1. Un `FB` (`status: new`) sin triar → `triage_feedback`.
2. Un `FR` (`status: proposed`) sin blueprint todavía.
3. Un issue de `get_drift_report` auto-sanable (doc stale, link roto).
4. Solo si ninguna de las anteriores aplica: el agente `rsi-ideation` propone una `FR` especulativa nueva,
   siempre con `justified_by` real. Nunca se salta al paso 4 si hay señal real disponible.

### Regla de nunca-saltar-hooks

`pre-commit` y `pre-push` (`scripts/hooks/`) son el gate real de calidad de este repo — CI en GitHub
Actions solo re-verifica build/typecheck/unit/audit. El loop **nunca** usa `--no-verify`, **nunca** setea
`PRDM_SKIP_HOOKS=1`, y **nunca** hace `git push --force` sobre `main` ni `git reset --hard`. Un rollback
siempre es `git revert --no-edit` (`packages/server/scripts/rollback.mjs`) — un commit normal, gated por
los mismos hooks que cualquier otro cambio.

### Agentes de revisión obligatorios

Cada Work Order pasa por `planner` → `tdd-guide` (RED/GREEN/REFACTOR, 80%+ cobertura) → `code-reviewer`
(siempre) → `security-reviewer` (cuando el WO toca auth/pagos/datos de usuario/BD/APIs externas/cripto —
evaluado por ciclo, nunca salteado por tratarse de una corrida desatendida).

### Binding de token/assignee

El loop reclama Work Orders como `agent:rsi-loop`, con su propio `PRDM_TOKEN` dedicado (no el token
interactivo de una sesión humana) — así `get_metrics` puede seguir separando trabajo de agente vs. humano,
y los commits quedan correctamente atribuidos.

### Circuit breaker

Estado en `~/.local/state/prdmanager-rsi/loop-state.json`. Se pausa tras 3 fallos de ciclo consecutivos, o
de inmediato si un rollback también falla su smoke-check (posible caída de producción, siempre peor que un
ciclo de feature fallido). Un sentinel en `~/.local/state/prdmanager-rsi/PAUSE` es el kill switch manual:
el driver lo revisa antes de cada ciclo y no invoca a `claude` si está presente.

### Verbos systemctl permitidos/prohibidos

Permitidos (vía `.claude/settings.rsi.json`): `systemctl --user restart|status prdmanager-server.service`.
Prohibidos explícitamente: `systemctl --user stop|disable` sobre cualquiera de las dos unidades
(`prdmanager-server.service`, `prdmanager-rsi.service`) — así un `stop` humano nunca puede ser
auto-reparado por el propio loop.
