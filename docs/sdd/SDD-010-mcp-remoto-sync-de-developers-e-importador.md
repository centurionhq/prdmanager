---
id: SDD-010
type: SDD
title: "MCP remoto, sync de developers con drift verificado por CI e importador de repos prdm"
status: active
architects: ["PRD-005"]
impacts_paths: ["packages/server/src/**", "packages/server/tests/**", "packages/server/*.json", "packages/mcp/src/**", "packages/cli/src/**", "packages/cli/tests/**", "packages/cli/package.json", "packages/core/src/**", "packages/contracts/src/**", "packages/contracts/tests/**", "packages/db/src/**", "packages/db/tests/**", "packages/db/migrations/**", "packages/app/src/**", "packages/app/tests/**", "packages/app/*.config.ts", "packages/testkit/src/**", ".github/workflows/prdm-sync.yml", ".gitignore", "vitest.config.ts", "README.md", ".env.example", "package.json", "package-lock.json"]
created_at: 2026-09-13
tags: ["saas", "remote-mcp", "sync", "drift", "cli", "import", "oidc"]
---

## Contexto

PRD-005: los developers toman lo publicado con su code assistant vía un **MCP remoto**, y el drift y la política `Refs:` siguen funcionando aunque el código viva en repos de cada organización, que el SaaS nunca lee directamente. Hoy el MCP es solo stdio y liga un proyecto al arrancar; `completeWorkOrder` verifica el commit con `git` local; `checkCommitMessage` y `checkCommitRange` leen los documentos de política desde git; `.prdm.yaml` es un schema estricto. `PgProjectEngine`, `EngineOps.readCommit`, `lastReport` y las tablas `commits`/`project_code_state` vienen de SDD-007; tokens, scopes y funciones de resolución previa al tenant, de SDD-006.

**Modelo de amenazas asumido:** cualquiera que pueda abrir un PR o editar archivos del repo puede cambiar `.prdm.yaml`, `.mcp.json` y los workflows, y leer secretos de CI expuestos a workflows de ramas. Por eso nada que venga del repo decide a qué servidor ni a qué proyecto se envía un token, qué política rige, ni qué reporte es oficial. **Riesgo aceptado:** el código que corre en la rama por defecto es confiable (es quien calcula `governed[]`, `commits[]` e `impacts_hashes` del reporte oficial); la guía exige protección de rama con PR revisado.

## MCP remoto

- `POST /mcp/:graphProjectId` con `StreamableHTTPServerTransport` del SDK 1.30.0 **sin estado** (GET y DELETE responden 405): cada request crea un `McpServer` con `registerPrdmTools(server, deps, {profile: 'remote'})` sobre `{settings, store: db.forProject(ref), engine: PgProjectEngine}`; los metadatos del servidor (versión) se leen una vez al arrancar, no por request. Rate limit por token contando cada tool de un batch JSON-RPC. `Origin` presente debe estar en la allowlist.
- **Auth:** `Authorization: Bearer prdm_pat_...` resuelto con la función `SECURITY DEFINER` de SDD-006 → token vigente con scope `mcp:*` (los tokens de CI no acceden a `/mcp`) → la organización del token es dueña del proyecto → proyecto dentro de `project_ids` si está acotado → rol del usuario. Sin cookies (sin CSRF). Cada llamada se audita con el nombre de la tool. `/mcp` sin proyecto expone solo `list_projects`.
- **Perfil remoto:**

| Tools | Requisito |
|---|---|
| `get_project`, `get_node`, `search_nodes`, `get_feature_branch`, `get_feature_tree`, `list_work_orders`, `get_work_order_context`, `get_metrics`, `get_closure_readiness`, `triage_feedback`, `get_drift_report` (sobre `lastReport`, nunca refresca), prompt `implement_work_order`, recursos de lectura | `mcp:read`, rol ≥ viewer |
| `claim_work_order` | `mcp:write`, developer/editor/admin; `assignee` debe ser `dev:<handle del token>` o `agent:<nombre>`, y se registra `claimed_by_user_id` |
| `complete_work_order` | `mcp:write`, developer+; `commit_sha` obligatorio; `ops.readCommit` solo acepta commits con confianza `baseline` (reportados por CI verificado) cuyo `Refs:` incluye ese WO; si no, responde `commit_not_verified_by_ci` |
| `submit_feedback` | `mcp:write`, commenter+ |
| No expuestas: autoría (`draft_artifact` y afines, `author_artifact`), `generate_work_orders`, `acknowledge_sync`, `refresh_index`, `create_feature_request`, `attach_artifact` | La autoría y el reconocimiento de drift ocurren en el dashboard |

- **Configuración del code assistant:** `prdm link --mcp` agrega a `.mcp.json` una entrada **stdio sin secretos** `{"command": "prdm", "args": ["mcp-proxy"]}`, que usa la instalación de prdm a nivel usuario (nunca `npx` ni un binario del `node_modules` del repo, que el repo controla; el proxy se niega a correr desde dentro del `node_modules` del repo). `prdm mcp-proxy` reenvía JSON-RPC por Streamable HTTP usando la credencial guardada **para ese origin exacto** y el **proyecto fijado en la configuración local al hacer `prdm link`** (por ruta del repo); si `.prdm.yaml` apunta a otro servidor u otro proyecto, aborta sin enviar nada. `prdm link` sugiere tokens acotados con `project_ids`. Un `.mcp.json` versionado nunca expande variables con tokens.

## CLI: credenciales y vinculación

- `prdm login --server <url>`: token por prompt oculto, verificado con `GET /api/v1/me`, guardado en `$XDG_CONFIG_HOME/prdm/credentials.json` con clave = origin exacto (archivo 0600, directorio 0700, abierto sin seguir symlinks y rechazado si otros pueden leerlo). Solo `https` salvo loopback, validado con `URL`. `fetch` con `redirect: 'error'`. `prdm logout`.
- **Tokens ligados a origin:** la CLI y el proxy envían un token solo al origin de su credencial. En CI el servidor sale de `PRDM_SERVER` (variable del workflow) y el token de `PRDM_TOKEN`; si `remote.server` del repo difiere, se aborta **sin enviar nada**.
- `prdm link <org>/<proyecto> [--import] [--mcp]`: escribe `version: 2` en `.prdm.yaml` con la sección `remote: {server, org, project, offline_policy}` (el parser v1 informa "requiere prdm ≥ la versión que introduce remote"), `project.id` igual al `graph_project_id` que devuelve el servidor, y `.prdm/remote/` en `.gitignore` vía scaffold.
- **Modo remoto:** con `remote` presente, `git.*`, `lifecycle`, `ignore`, `folders` y `docs_dir` se toman **solo** de los `settings` del servidor, nunca del repo, y la CLI los valida con las mismas reglas que `.prdm.yaml` antes de usarlos. Los comandos mutantes locales (`wo generate`, `wo claim/complete`, `feedback add`, `fr create`, `ingest`, `close`, `sync ack`, `migrate docs`) y las tools de escritura del MCP stdio se rechazan con un mensaje que apunta al dashboard o al MCP remoto.

## Sync de developers y drift

- **`prdm sync` en modo remoto** (sin Neo4j local, con `loadProjectSettings`):
  1. `GET /api/v1/projects/:graphProjectId/governance` (scope `governance:read`) con `If-None-Match: "<graph_version>"`: settings y documentos publicados. La caché se escribe solo como `.prdm/remote/docs/<ID>.md` (id validado con `ID_PATTERN`) con `safeReplaceAtomic` bajo `.prdm/remote`, más un manifiesto; nunca en rutas que mande el servidor.
  2. Local: `scanContents` de la caché, `resolveGoverned` por blueprint, `readCommits`, `dirtyPaths`, rama y HEAD.
  3. `POST /api/v1/projects/:graphProjectId/code-reports` con `Idempotency-Key` aleatoria por intento (reutilizada solo en reintentos): `{schema_version, client: {prdm_version, hash_algo_version}, branch, head_sha, docs_graph_version, impacts_hashes, governed[], governed_warnings[], commits[] (autor solo nombre), dirty[]}` con límites de tamaño. En CI se adjunta el OIDC token de GitHub Actions. Un 409 `docs_outdated` refetchea y reintenta una vez.
  4. Imprime el drift devuelto; `--check` falla con issues bloqueantes.
- **Servidor:**
  - Idempotencia por `(project_id, token_id, idempotency_key)` guardando el sha256 del cuerpo; misma clave con otro cuerpo → 422 `idempotency_mismatch`.
  - **Modo baseline** solo si se cumplen **todas**: token de CI con scope `reports:baseline`; OIDC de GitHub verificado con `jose` 6.2.12 contra el JWKS de `https://token.actions.githubusercontent.com` con `iss` exacto, `alg RS256`, `exp`/`nbf`/`iat` con tolerancia ≤ 60 s, `jti` de un solo uso, `aud = PRDM_PUBLIC_URL`, `repository_id` y `repository_owner_id` iguales a los capturados en `settings` al configurar el proyecto (no solo el nombre, que puede reutilizarse), `ref = refs/heads/<settings.default_branch>`, `event_name = push` y `sha = head_sha`; `head_sha` no es un head de baseline ya registrado ni ancestro de uno según los commits reportados (un force-push a la rama por defecto requiere override de admin auditado); `hash_algo_version` coincide con la de `settings`. Entonces actualiza `project_code_state` (con `impacts_hashes`) y corre `PgProjectEngine.refresh()`: drift oficial, updates de WOs y proyección. La vista oficial muestra el nombre del token y `head_sha`.
  - Cualquier otro reporte es **vista previa**: `detectDrift` puro contra la baseline guardada, visible en el dashboard, sin escribir baseline, WOs ni grafo. Adaptador puro `codeReportToDriftInput`.
  - `commits` guarda `(project_id, sha, trust, reporter_token_id, first_seen_at)` con `trust = baseline | preview`; un reporte baseline reemplaza el mensaje y las refs de uno preview; nunca al revés.
- **Política `Refs:`:** seam `PolicyDocsSource` en `checkCommitMessage`/`checkCommitRange` (el modo local no cambia). En modo remoto el hook `commit-msg` usa la caché (refetch con timeout corto si tiene más de 10 minutos; offline evalúa con aviso; sin caché aplica `offline_policy` warn/block). En CI, `check commits --range` pide en un solo request `GET /policy-docs` evaluado a la fecha `first_seen_at` de cada sha registrada por el servidor (o a la actual si no fue reportado), nunca a la fecha declarada por git. Los documentos de política ya no están en el repo, así que un PR no puede alterar su propia política.

## Importador

`prdm link --import` lee `docs/`, `.prdm.yaml` y `.prdm/baseline.json` locales, los valida con el core y los sube a `POST /api/v1/projects/:graphProjectId/import` (scope `import:write`, admin de proyecto, límite de cuerpo y de cantidad de documentos). El servidor **re-valida todo** con `scanContents` y el core, falla si el proyecto no está vacío, ignora el `project.id` local, normaliza cada `source_path` a `<carpeta del kind>/<ID>*.md` rechazando rutas inseguras, crea los documentos publicados con sus ids, estados, WOs y relaciones, construye cada `Y.Doc` desde el Markdown como transacción de `system:import`, siembra `id_counters`, importa `lifecycle.grandfathered` y la baseline con `trust = import` (así el primer reporte de CI no convierte en oficial un drift ya existente; la vista de drift la marca "no verificada por CI" hasta el primer reporte con OIDC), crea versiones `import` y audita `resolved_by`, `blueprint_hashes` y `grandfathered` como cambios privilegiados. Test de ida y vuelta: `contentHash(render(projectDoc(import(raw)))) == contentHash(raw)` para cada documento de este repositorio. El dogfooding sobre este repo no commitea `remote:`: su CI sigue en modo local.

## Dashboard

Vistas de drift: rama por defecto (oficial, con token y `head_sha`), vistas previas por rama e historial de reportes; lista de WOs del proyecto.

## Tests

Unitarios de contratos, adaptador de drift, verificación de claims OIDC con JWKS de prueba, idempotencia, caché de política con reloj inyectado y escritura segura de la caché. Integración: MCP con `StreamableHTTPClientTransport` contra el servidor en proceso (scopes, IDOR entre proyectos, allowlist de tools, casos en la suite de aislamiento); CLI remota con repo fixture de testkit contra el servidor de test; PR que falsifica `branch` o carece de OIDC; `.prdm.yaml` que apunta a otro servidor; commit falsificado por un developer; front-running de `Idempotency-Key`; traversal en `source_path` y symlinks en la caché; hook `commit-msg` offline; importador sobre un fixture y sobre la forma de este repo. E2E Playwright del recorrido completo con `FakeLlmClient` y OIDC de prueba.

## Tareas

- [ ] Contratos zod de governance, code reports con hash_algo_version e impacts_hashes, policy docs e importación con límites de tamaño en packages/contracts, con tests
- [ ] Endpoint GET governance con ETag por graph_version y settings del servidor, con tests
- [ ] Verificación de OIDC de GitHub Actions con jose 6.2.12 (JWKS, iss, alg, tiempos, jti de un solo uso, audiencia, repository_id y owner id, ref de la rama por defecto, event push y sha) inyectable en buildServer, con tests con JWKS de prueba
- [ ] Endpoint POST code-reports con idempotencia por token y hash del cuerpo y vista previa por defecto, con tests de front-running
- [ ] Modo baseline de code-reports solo con token de CI, OIDC verificado, head que no retrocede con override de admin auditado y hash_algo_version coincidente, con tests de rama falsificada, token de feature branch y force-push
- [ ] Commits reportados con nivel de confianza baseline o preview, first_seen_at y precedencia de baseline, con tests de commit falsificado por developer
- [ ] Endpoint de policy docs evaluados a first_seen_at de cada sha en un único request, con tests
- [ ] MCP remoto POST /mcp/:graphProjectId con transporte Streamable HTTP sin estado, GET y DELETE 405, Bearer con scope mcp, rate limit por tool, Origin validado y perfil de tools remoto, con tests con cliente Streamable HTTP
- [ ] Casos de tools MCP de otra organización y de otro proyecto en la suite de aislamiento
- [ ] claim_work_order remoto con assignee ligado al handle del token y claimed_by_user_id, y complete_work_order con sha obligatorio verificado contra commits baseline, con tests
- [ ] CLI prdm login y logout con credenciales por origin exacto en XDG_CONFIG_HOME con permisos estrictos, https salvo loopback y fetch sin redirects, con tests
- [ ] CLI prdm link con .prdm.yaml version 2 y sección remote, mensaje claro del parser v1, .prdm/remote/ en el gitignore del scaffold y entrada stdio de prdm mcp-proxy en .mcp.json, con tests
- [ ] CLI prdm mcp-proxy stdio desde la instalación de usuario que reenvía al MCP remoto solo con la credencial del origin exacto y el proyecto fijado al hacer link, y aborta si .prdm.yaml apunta a otro servidor o proyecto, con tests
- [ ] Settings de gobernanza en modo remoto tomados solo del servidor y validados, y PRDM_SERVER obligatorio en CI, con tests
- [ ] Rechazo en modo remoto de comandos mutantes locales de la CLI y de tools de escritura del MCP stdio con mensaje que apunta al dashboard o al MCP remoto, con tests
- [ ] Endpoint de importación que re-valida con el core, exige proyecto vacío, normaliza source_path y crea documentos publicados con Y.Doc de system:import, con tests
- [ ] Importación de contadores, grandfathered y baseline con trust import marcada como no verificada por CI, con auditoría de campos privilegiados, con tests
- [ ] CLI prdm link --import que lee docs, .prdm.yaml y baseline locales, valida y sube con resumen, con test de ida y vuelta de contentHash sobre los documentos de este repositorio
- [ ] CLI prdm sync en modo remoto con caché de governance escrita por id con safe-fs, resolveGoverned y readCommits locales, OIDC adjunto en CI, envío idempotente y --check, con tests de traversal, symlink y contra servidor de test
- [ ] Seam PolicyDocsSource en checkCommitMessage y checkCommitRange sin cambio en modo local, con tests
- [ ] commit-msg remoto con caché, offline_policy y aviso de caché vieja, con tests
- [ ] check commits --range remoto con policy docs a first_seen_at, con tests
- [ ] Vistas de drift en la app para rama por defecto con token y head_sha, vistas previas por rama e historial de reportes, con tests
- [ ] CI en .github/workflows/prdm-sync.yml con servicio Postgres, job de tests de integración, job E2E de Playwright y npm audit
- [ ] E2E Playwright: dos contextos coeditan, comentan y ven blame, el agente con LLM falso propone y se acepta, el admin publica PRD y SDD, se generan WOs y un cliente MCP reclama y completa un WO tras un reporte de CI con OIDC de prueba
- [ ] Guía en README de login, link, import, mcp-proxy, hooks y workflow de GitHub Actions con permisos id-token, PRDM_SERVER, PRDM_TOKEN en un Environment de la rama por defecto y sin pull_request_target
- [ ] Correcciones de la revisión final paralela de arquitectura, seguridad y rendimiento
- [ ] Dogfooding con sync --check en 0 y cobertura de 80% o más
- [ ] La ruta nueva del dashboard de drift (WO-199, GET .../drift/reports) quedó sin su entrada en la suite de aislamiento (WO-111); descubierto porque el job de CI sync-check solo corre npm run test:unit, que no incluye packages/server/tests/isolation/ — agregar el probe y verificar los casos cross-org/cross-project
- [ ] Corregir flakiness de CI en el test de runMcpProxy: reemplazar la espera fija de 50ms por una espera basada en el evento real de envío del relay, ya que falló en el runner de CI más lento
- [ ] Revisión de seguridad #4 (CRITICAL): la detección de force-push/reescritura de historia depende del array commits[] declarado por el cliente en vez de verificar la ascendencia real; corroborar de forma independiente (API de GitHub con el token de instalación verificado por OIDC, o una prueba de cadena de padres) en vez de confiar en la membresía del array reportado, con test de un head_sha reescrito que incluye el head anterior de forma fabricada
- [ ] Revisión de seguridad #4 (HIGH): los recursos y prompts del MCP remoto (resources/read, prompts/get) no pasan por instrumentToolCalls y quedan sin scope, sin auditoría y sin rate limit; envolver registerResource/registerPrompt igual que registerTool, con test de que un token sin mcp:read es rechazado y de que cada llamada se audita
- [ ] Revisión de seguridad #4 (HIGH): el registro de baseline hace la verificación de idempotencia después de los efectos (upsert de commits, refresh del engine) y la actualización de impacts_hashes es un read-modify-write sin lock, permitiendo un lost-update entre dos reportes de baseline concurrentes distintos; serializar con el mismo advisory lock de refresh() y mover la verificación de idempotencia antes de cualquier efecto, con test de concurrencia real
- [ ] Revisión de seguridad #4 (HIGH): project.id en .prdm.yaml es controlado por el repo y se usa sin un pin local no controlado por el repo, permitiendo que un PR redirija sync/mcp-proxy a otro proyecto; grabar el graphProjectId vinculado en el almacén local de credenciales al hacer prdm link y abortar si no coincide con .prdm.yaml, igual que ya se hace con el server, con test
- [ ] Revisión de seguridad #4 (HIGH): la verificación de "proyecto vacío" del importador es check-then-act sin lock ni idempotency key bajo READ COMMITTED, permitiendo dos importaciones concurrentes al mismo proyecto vacío; usar un advisory lock por proyecto o una idempotency key en el endpoint de importación, con test de concurrencia real
- [ ] Revisión de seguridad #4 (MEDIUM): pasar redirect: 'error' también en la construcción de StreamableHTTPClientTransport (mcp-client.ts y mcp-proxy.ts), no solo en los fetches de login/sync/import, con test de un servidor que redirige
- [ ] Revisión de seguridad #4 (MEDIUM): agregar un bodyLimit explícito al endpoint de policy-docs para consistencia con el resto de las rutas nuevas
- [ ] Revisión de seguridad #4 (HIGH, seguimiento de WO-234): commit-msg.ts y check-range.ts también leen project.id de .prdm.yaml sin cruzarlo contra el pin local; usar checkProjectPinMismatch (ya compartido por sync.ts y mcp-proxy.ts) en ambos, con test
- [ ] Implementar PRDM_TOKEN en CI: sync.ts, commit-msg.ts y check-range.ts solo leen credenciales del archivo local, así que CI (sin ese archivo) nunca puede autenticarse a pesar de que el SDD y server-origin.ts ya asumen PRDM_TOKEN; agregar resolveRemoteCredential (obligatorio en CI, igual que PRDM_SERVER en server-origin.ts) y usarlo en los tres call sites, con test
- [ ] El job integration-tests de prdm-sync.yml (primera corrida real) falló en dos suites pre-existentes que ninguna corría en CI hasta ahora: packages/cli/tests/e2e/isolation-and-authoring.test.ts lee NEO4J_PASSWORD de un .env que no existe en el runner, y packages/server/tests/integration/password-reset.test.ts necesita un SMTP real (mailpit) que el job no levanta; escribir un .env mínimo en el job y agregar el servicio mailpit, con la corrida de CI en verde como criterio de aceptación

El cierre de PRD-005 con `prdm close PRD-005 --ack` no es una tarea: se ejecuta cuando todos los WOs de ADR-005, ADR-006 y SDD-006 a SDD-010 están terminados.
