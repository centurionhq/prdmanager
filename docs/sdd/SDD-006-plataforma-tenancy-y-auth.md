---
id: SDD-006
type: SDD
title: "Plataforma SaaS: tenancy, autenticación por invitación, permisos, tokens y shell del dashboard"
status: active
architects: ["PRD-005"]
impacts_paths: ["packages/contracts/src/**", "packages/contracts/tests/**", "packages/contracts/*.json", "packages/db/src/**", "packages/db/tests/**", "packages/db/migrations/**", "packages/db/*.json", "packages/db/*.config.ts", "packages/server/src/**", "packages/server/tests/**", "packages/server/scripts/**", "packages/server/*.json", "packages/server/Docker[f]ile", "packages/server/Dockerfile.dockerignor[e]", "packages/app/src/**", "packages/app/tests/**", "packages/app/*.json", "packages/app/*.config.ts", "packages/app/index.htm[l]", "packages/ui/src/**", "packages/ui/tests/**", "packages/ui/*.json", "packages/web/src/**", "packages/web/tests/**", "packages/web/package.json", "packages/web/tsconfig*.json", "packages/web/vite.config.ts", "packages/testkit/src/**", "packages/testkit/package.json", "docker/**", "docker-compose.yml", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.base.json", "tsconfig.test.json", "vitest.config.ts", ".env.example", ".gitignore", "README.md", ".github/workflows/prdm-sync.yml"]
created_at: 2026-09-13
tags: ["saas", "tenancy", "auth", "rbac", "dashboard"]
---

## Contexto

PRD-005, stack en ADR-006 y runtime en ADR-005. Hoy no existe identidad de usuario (solo actores `agent:x|dev:x` autodeclarados), ni organizaciones, ni base relacional; `packages/web` es un explorador local de un proyecto, ligado a loopback con guardia de `Host`, sin auth y solo `GET`. Este SDD crea la plataforma sobre la que se apoyan SDD-007 (documentos y engine), SDD-008 (colaboración), SDD-009 (agente) y SDD-010 (MCP remoto, sync e importador).

**Sobre `impacts_paths`:** como en SDD-005, se listan subdirectorios de código y manifiestos en vez de `packages/x/**` (evita gobernar `dist/`). Los archivos únicos que todavía no existen usan un patrón dinámico equivalente (`Docker[f]ile`, `Dockerfile.dockerignor[e]`, `index.htm[l]`): un literal inexistente resuelve con hash nulo y bloquea sync como `missing`, un patrón sin coincidencias solo avisa. Se re-listan los archivos compartidos de la raíz porque los WOs de SDD-005 están terminados. Todo paquete nuevo declara `engines.node ">=24"` (ADR-005).

## Arquitectura

```
packages/contracts   DTOs zod isomórficos (sesión, proyectos, miembros, tokens; luego documentos y sync)
packages/db          esquema Drizzle, migraciones SQL (RLS, funciones SECURITY DEFINER), withTenantTx, repositorios con alcance
packages/ui          tokens.css + test de contraste y componentes del explorador extraídos de packages/web
packages/server      Fastify: buildServer(deps) sin listen; better-auth en /api/auth/* (allowlist); API de sesión /api/app/*;
                     API con token /api/v1/*; /collab (SDD-008); /mcp (SDD-010); bundle de packages/app
packages/app         SPA React 19.3.0 + Vite 8.3.0 + react-router 8.3.1 (modo data)
```

Dependencias en un solo sentido: `core`, `db`, `mcp/lib`, `collab`, `contracts` ← `server`; `contracts` ← `db`, `cli`; `core/domain`, `contracts`, `ui`, `collab` ← `app`; `ui` ← `web`. Nada depende de `server` ni de `app`; `db` no depende de `neo4j-driver` (`PgProjectEngine` vive en `packages/server/src/engine/`, SDD-007). `packages/web` sigue siendo el explorador local de PRD-004 (loopback, sin auth): solo pasa a consumir `@prdm/ui`.

`buildServer({env, db, graph, mailer, clock, llm?, oidc?})` recibe todo inyectado; `main.ts` es el único que lee el entorno y escucha. Envelope de error `{error:{code,message}}` con códigos `validation_error | unauthorized | forbidden | not_found | conflict | rate_limited | internal_error`; los 500 nunca exponen el mensaje real. Cualquier recurso de otra organización o proyecto responde **404** (nunca 403, que confirma existencia).

**Glosario de identificadores:** URLs públicas de CLI y MCP usan `graph_project_id` (`prj_…`) y `doc_id` (`PRD-012`); la app usa `orgSlug`, `projectSlug` y `doc_id`; los uuid son internos.

## Modelo de datos

Tablas de better-auth (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `twoFactor`) generadas para Drizzle; son globales (sin RLS). Además:

| Tabla | Claves |
|---|---|
| `user_profile` | `user_id` pk, `handle` único, **inmutable y nunca reutilizado**, que cumple `ACTOR_PATTERN` (así `dev:<handle>` es un actor válido del core) |
| `platform_admins` | `user_id` pk, `created_at`, `created_by`; `prdm_app` solo `SELECT` |
| `projects` | `id` uuid, `org_id`, `slug` único por org, `name`, `graph_project_id` (`prj_<16hex>` generado siempre por el servidor, único), `settings jsonb` (subset validado de `.prdm.yaml`: folders, lifecycle.grandfathered, git, triage, ignore, `default_branch`, `github_repository`, `github_repository_id`, `github_owner_id`, `hash_algo_version`), `graph_version`, `graph_dirty`, `archived_at`; UNIQUE `(id, org_id)` para FKs compuestas |
| `project_members` | (`project_id`, `user_id`) pk, `org_id`, `role` admin/editor/developer/commenter/viewer |
| `invitation_secrets` | `invitation_id` pk, `org_id`, `secret_hash` sha256 de 32 bytes, `expires_at`, `consumed_at` |
| `project_invitation_grants` | `invitation_id`, `org_id`, `project_id`, `role` |
| `api_tokens` | `org_id`, `kind` personal/project_ci, `user_id`, `project_ids`, `name`, `prefix` visible (`prdm_pat_`/`prdm_ci_`) + checksum, `secret_hash`, `scopes`, `expires_at` **obligatorio** (≤ 90 días), `last_used_at`, `revoked_at` |
| `audit_log` | append-only por organización: `org_id`, `project_id`, actor (usuario o token), `action`, `target`, `metadata` sin secretos, `ip`, `user_agent` |
| `platform_audit_log` | append-only sin organización (inicios de sesión fallidos, acciones de superadmin); `prdm_app` solo `INSERT`, lectura por función `SECURITY DEFINER` para superadmins |

**Aislamiento por capas.**
1. **Repositorios con alcance:** `db.forOrg(orgId).forProject(projectId)`; ningún método recibe `org_id` crudo del request. El `org_id` siempre se deriva del servidor (sesión + membresía del `orgSlug`, o la organización del token).
2. **RLS forzado:** toda tabla salvo las de better-auth, `platform_admins` y `platform_audit_log` tiene `org_id NOT NULL`, RLS habilitado y forzado con `USING/WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), ''))`, y **FKs compuestas** `(project_id, org_id) → projects(id, org_id)` (análogo para documentos), para que una referencia a otra organización falle. `withTenantTx(orgId, fn)` fija `app.org_id` con `set_config(..., true)` por transacción. La app conecta como `prdm_app`: sin `BYPASSRLS`, sin membresía en `prdm_owner`, sin `CREATE` en el esquema; las migraciones corren como `prdm_owner`; las vistas usan `security_invoker = true`.
3. **Resolución previa al tenant:** lo que se busca antes de conocer la organización (token por hash, proyecto por uuid o `graph_project_id`, documento por uuid, invitación por secreto) pasa **solo** por funciones `SECURITY DEFINER` propiedad de `prdm_owner`, con `SET search_path = pg_catalog, public`, que devuelven únicamente `org_id` y los ids necesarios. No existe ningún pool sin RLS en el servidor.
4. **Suite de aislamiento:** harness por tabla que, con credenciales de la organización B (y de otro proyecto de la misma organización A), invoca cada ruta HTTP registrada, cada endpoint habilitado de better-auth, cada tool de `tools/list` del MCP remoto y cada `documentName` de `/collab` contra ids de A; exige 404 y que un texto canario de A nunca aparezca. Un test de catálogo (`pg_class`, `pg_policy`, `pg_auth_members`) falla si una tabla no permitida carece de `org_id`, RLS forzado o FK compuesta, o si `prdm_app` puede asumir `prdm_owner` o escribir `platform_admins`.

**Aislamiento entre proyectos:** por defecto nada. Un miembro de la organización sin fila en `project_members` no ve el proyecto; owner y admin de organización heredan admin de proyecto.

## Autenticación

- **Superficie de better-auth en allowlist:** de `/api/auth/*` solo se montan `sign-in/email`, `sign-out`, `get-session`, `request-password-reset`, `reset-password`, `change-password`, `list-sessions`, `revoke-session(s)` y los de `two-factor` necesarios para superadmins; todo lo demás responde 404 (test que enumera `auth.api`). Plugin organization con `allowUserToCreateOrganization: false` y `disableOrganizationDeletion: true`; organizaciones, miembros, roles e invitaciones solo se mutan por `/api/app/*`, que audita, aplica grants y revoca conexiones. `update-user` limitado a `name`; `change-email` y `delete-user` deshabilitados.
- **Solo por invitación:** sign-up público deshabilitado. El email de invitación lleva un **secreto de un solo uso de 32 bytes distinto del id** (`invitation_secrets`) en el fragmento de la URL (`/invite/:id#s=<secreto>`, que no llega a logs de proxies ni CDNs; la SPA lo envía por POST), que expira con la invitación y se consume en la misma transacción. Usuario nuevo: el handler valida el secreto, crea el usuario con el email de la invitación (no editable) y `emailVerified=true`, fija la contraseña y acepta atómicamente. Usuario existente: exige sesión con ese email más el secreto. Ningún listado devuelve secretos. Nombres de organización y usuario se escapan en HTML y se les quitan CR/LF en los emails.
- **Superadmin:** el primero se crea con un comando de bootstrap del servidor que usa credenciales `prdm_owner`, pide la contraseña por prompt oculto (nunca argv ni env), falla si ya existe uno salvo `--additional` y queda en `platform_audit_log`. Los superadmins tienen **TOTP obligatorio**: el bootstrap exige enrolarlo antes de la primera acción, las rutas `/admin` y la creación de organizaciones exigen una sesión con 2FA verificada y `trustDevice` está deshabilitado para ellos. **No tienen acceso implícito al contenido** de las organizaciones: solo crean organizaciones invitando a su owner.
- **Reseteo y sesiones:** `baseURL = PRDM_PUBLIC_URL` obligatorio en el esquema de entorno; hook `onRequest` que rechaza `Host` distinto del público; `trustedProxyHeaders` y `trustProxy` solo con `PRDM_TRUST_PROXY=1`, usando la misma fuente de IP en better-auth y en `@fastify/rate-limit`. `verification.storeIdentifier: 'hashed'`; `revokeSessionsOnPasswordReset: true`; cambiar la contraseña revoca las otras sesiones, los tokens personales y las conexiones `/collab`. `session.cookieCache` deshabilitado. Contraseña mínima 12, hash por defecto de better-auth. `BETTER_AUTH_SECRET` ≥ 32 bytes validado.
- **Cookies:** prefijo `__Host-` en producción, httpOnly, `Secure`, `SameSite=Lax`; `trustedOrigins` y `PRDM_TRUSTED_ORIGINS` salen de una sola variable, sin comodines.
- **Rate limit:** por IP y por cuenta en sign-in, reset, `change-password`, aceptar invitación y autenticación Bearer fallida.

## Permisos

Matriz pura `can(role, action)`; owner y admin de organización heredan admin de proyecto. Un admin de organización no puede otorgar, quitar ni degradar a un owner, y no se puede quitar al último owner.

| Acción | admin | editor | developer | commenter | viewer |
|---|---|---|---|---|---|
| Ver documentos (copia de trabajo en solo lectura), grafo, drift | ✓ | ✓ | ✓ | ✓ | ✓ |
| Comentar; enviar feedback | ✓ | ✓ | ✓ | ✓ | |
| Borrar comentarios ajenos | ✓ | | | | |
| Crear y editar documentos, pedir revisión, restaurar versión | ✓ | ✓ | | | |
| Usar el agente y aceptar sus propuestas | ✓ | ✓ | | | |
| Publicar, archivar, reconocer drift, cerrar feature | ✓ | | | | |
| Reclamar y completar WOs; reportar código (vista previa) | ✓ | ✓ | ✓ | | |
| Miembros, roles, settings del proyecto (auditados), tokens de CI, importar | ✓ | | | | |

**Scopes de tokens** (el permiso efectivo es scope ∩ rol; toda ruta y tool declara su scope y registrar una sin scope falla):

| Scope | Token personal | Token de CI |
|---|---|---|
| `mcp:read`, `mcp:write` | ✓ | — (sin acceso a `/mcp`) |
| `governance:read` | ✓ | ✓ |
| `reports:write` (vista previa) | ✓ | ✓ |
| `reports:baseline` (con OIDC, SDD-010) | — | ✓ |
| `import:write` (admin de proyecto) | ✓ | — |

Tokens: búsqueda por sha256 vía función `SECURITY DEFINER`; revocación inmediata; `last_used_at` como máximo una vez por minuto; un plugin Bearer separado del de sesión (una ruta nunca acepta ambos).

## Cabeceras, CSRF y logs

- `@fastify/csrf-protection` (doble envío) + chequeo de `Origin`/`Sec-Fetch-Site` en toda ruta mutante con sesión.
- CSP de PRD-004 con `connect-src 'self' wss://<host público exacto>` (nunca `wss:` suelto), `img-src 'self' data:`, nonce de estilo para CodeMirror en lugar de `'unsafe-inline'`; HSTS en producción.
- Esquema de entorno zod leído una sola vez; el logger de Fastify redacta `authorization`, `cookie`, `set-cookie` y claves sensibles, y un serializador de `req` enmascara `/reset-password/*`, `/invite/*` y query strings; better-auth usa el mismo logger. Tests de que ni `DEEPSEEK_API_KEY`, ni `BETTER_AUTH_SECRET`, ni tokens de reseteo, invitación o Bearer aparecen en logs ni en `metadata` de auditoría.

## Dashboard (shell)

Rutas: `/login`, `/reset-password`, `/invite/:id`, `/admin` (superadmin: organizaciones), `/o/:org` (proyectos), `/o/:org/settings/members`, `/o/:org/p/:project` (lista de documentos), `/o/:org/p/:project/settings`, `/settings/tokens`, `/settings/profile`. Cliente de API tipado con `contracts`, CSRF y errores. Estética: tokens "Stark HUD" de PRD-004 movidos a `@prdm/ui` con su test de contraste, y la skill `ui-ux-pro-max` para los layouts nuevos. Al crear una organización se informa que el contenido se procesa con DeepSeek.

## Local y despliegue

`docker-compose.yml` suma `postgres` (`127.0.0.1:5432`), `postgres-test` (perfil `test`, `127.0.0.1:5433`, tmpfs) y `mailpit` (`127.0.0.1:1025`/`8025`), con imágenes fijadas por digest, y un script en `docker/postgres/init/` que crea `prdm_owner` y `prdm_app`. `.env.example` solo con nombres. `npm run dev` ejecuta `packages/server/scripts/dev.mjs` (servidor con `tsx watch` y Vite con proxy de `/api`, `/collab` y `/mcp`). Dockerfile multi-etapa `node:24.21.0-bookworm-slim` fijado por digest, usuario no root y healthcheck, construido con la raíz del repo como contexto y `packages/server/Dockerfile.dockerignore` (ignore por Dockerfile de BuildKit, ya que un `.dockerignore` junto al Dockerfile no se lee con contexto en la raíz). Despliegue en la nube fuera de alcance.

## Tests

Unitarios de la matriz de permisos, scopes, tokens, esquema de entorno y redacción. Integración contra Postgres de test (5433) con migraciones y truncado entre tests, más Neo4j de test (7688). Suite de aislamiento y test de catálogo. Cliente con jsdom. Nada con aserciones de tiempo de reloj.

## Tareas

Nota general: toda tarea que agregue dependencias incluye `package-lock.json` en el mismo commit, y todo paquete nuevo declara `engines.node ">=24"`.

- [ ] Scaffold de packages/contracts y packages/db (drizzle-orm 0.45.2, drizzle-kit 0.31.10, pg 8.23.0) con tsconfig, referencias en tsconfig.json raíz y alias en vitest.config.ts
- [ ] Scaffold de packages/server con buildServer inyectable sin listen, main.ts, GET /api/health y envelope de errores con unauthorized, forbidden, conflict y rate_limited
- [ ] docker-compose con postgres y postgres-test (perfil test, 5433, tmpfs) con imágenes fijadas por digest, mailpit, script de roles prdm_owner y prdm_app sin BYPASSRLS ni membresía en prdm_owner, y nombres de variables en .env.example
- [ ] Puertos locales de postgres, postgres-test y mailpit configurables por entorno en docker-compose con los valores por defecto del SDD, para máquinas donde ya están ocupados, documentados en .env.example
- [ ] Harness de integración en testkit para Postgres de test con migraciones, truncado entre tests y fábricas de organización, usuario y proyecto
- [ ] Esquema de entorno del servidor con zod (PRDM_PUBLIC_URL obligatorio, BETTER_AUTH_SECRET de 32 bytes o más) y redacción de secretos en el logger con serializador de URL, con test de que claves, cookies, Authorization y tokens de reseteo e invitación nunca aparecen en logs
- [ ] Esquema de better-auth generado para drizzle, user_profile con handle inmutable compatible con ACTOR_PATTERN y migración inicial
- [ ] better-auth montado en Fastify con allowlist de endpoints (resto 404), sign-up público y allowUserToCreateOrganization deshabilitados, sin change-email ni delete-user, con test que enumera auth.api
- [ ] Sesión endurecida: baseURL fijo, allowlist de Host, trustProxy explícito, identificadores de verificación hasheados, cookieCache deshabilitado, cookies __Host- y revocación de sesiones al resetear o cambiar contraseña, con tests de Host y X-Forwarded-Host envenenados
- [ ] Rate limit por IP y por cuenta en sign-in, reseteo, cambio de contraseña, aceptar invitación y Bearer fallido, con tests
- [ ] Reseteo de contraseña y envío de emails con nodemailer 10.0.9 escapando nombres (transporte falso en tests, mailpit en dev), con tests
- [ ] Funciones SECURITY DEFINER de resolución previa al tenant para token, proyecto por uuid y por graph_project_id, documento e invitación que solo devuelven org_id, con test de que prdm_app no tiene otra vía sin RLS
- [ ] Tablas projects y project_members con org_id, FKs compuestas, políticas RLS forzadas con NULLIF y withTenantTx que fija app.org_id, con tests
- [ ] Test de catálogo que falla si una tabla no permitida carece de org_id, RLS forzado o FK compuesta, o si prdm_app puede asumir prdm_owner o escribir platform_admins
- [ ] Repositorios con alcance de tenant (db.forOrg().forProject()) sin métodos que acepten org_id crudo, con tests
- [ ] Superadmin de plataforma: tabla platform_admins, comando de bootstrap con prompt oculto y credenciales de owner y endpoint para crear organizaciones invitando a su owner sin acceso implícito al contenido, con tests
- [ ] TOTP obligatorio para superadmins con el plugin twoFactor de better-auth, enrolamiento en el bootstrap, sesión con 2FA verificada en /admin y trustDevice deshabilitado, con tests
- [ ] Audit log append-only por organización y platform_audit_log sin organización, sin UPDATE ni DELETE para prdm_app, con test de metadata sin secretos
- [ ] Organizaciones con slug, organización activa en sesión y roles owner, admin y member con reglas de último owner, con tests
- [ ] Invitaciones con secreto de un solo uso separado del id y enviado en el fragmento de la URL, rol de organización y grants de proyecto, aceptación por usuario nuevo o existente, expiración y revocación, con tests de id sin secreto, reuso y doble aceptación
- [ ] Matriz de permisos pura de roles de organización y de proyecto por acción según la tabla del SDD, con tests de tabla exhaustivos
- [ ] Endpoints de proyectos con graph_project_id generado por el servidor, settings validados y auditados, miembros y roles, con tests
- [ ] CSRF con @fastify/csrf-protection 8.0.1 y chequeo de Origin y Sec-Fetch-Site en rutas mutantes, CSP con wss del host exacto y nonce de estilo, y HSTS en producción, con tests
- [ ] Tokens personales y de CI con prefijo con checksum, sha256, expiración obligatoria de hasta 90 días, revocación y last_used_at, y plugin Bearer separado del de sesión, con tests
- [ ] Registro de scopes declarados por ruta que falla si una ruta no declara scope, con tests de matriz scope por ruta
- [ ] Harness de la suite de aislamiento que recorre cada ruta registrada y endpoint de auth habilitado con credenciales de otra organización y de otro proyecto exigiendo 404 y ausencia de canario, extensible a tools MCP y documentName (SDD-008 y SDD-010 suman sus casos)
- [ ] Correcciones de la revisión de seguridad #1: revocar EXECUTE de PUBLIC en toda función SECURITY DEFINER (con test de catálogo que lo verifica por firma exacta) y reconciliar al arrancar el servidor cualquier membresía de organización que haya quedado en un superadmin por un fallo a mitad del flujo de creación, con tests
- [ ] Scaffold de packages/app (Vite 8.3.0, React 19.3.0, react-router 8.3.1 en modo data) con proxy de /api, /collab y /mcp, y bundle servido por el servidor con fallback SPA
- [ ] Scaffold de packages/ui con tokens.css movido desde packages/web y su test de contraste
- [ ] Mover a packages/ui to-elements, apply-drift y useCytoscape con sus tests, consumidos desde packages/web
- [ ] Mover a packages/ui GraphCanvas, TreeView, NodeDetailPanel, WorkOrderList y DriftBanner consumidos desde packages/web con su E2E local verde
- [ ] Cliente de API tipado con contracts, CSRF y errores, y pantallas de login, reseteo de contraseña y aceptar invitación, con tests
- [ ] Selector de organización y dashboard de proyectos con aviso de procesamiento por DeepSeek al crear la organización, con tests
- [ ] Administración de miembros, invitaciones y roles, con tests
- [ ] Página de tokens con secreto mostrado una sola vez, con tests
- [ ] Panel de superadmin de organizaciones, con tests
- [ ] Dockerfile multi-etapa del servidor con node 24.21.0 slim fijado por digest, usuario no root, healthcheck, contexto en la raíz y Dockerfile.dockerignore
- [ ] npm run dev con script Node sin dependencias en packages/server/scripts
