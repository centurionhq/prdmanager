---
id: ADR-006
type: ADR
title: "Stack de la plataforma SaaS: Postgres + better-auth + Hocuspocus/Yjs + CodeMirror + DeepSeek"
status: active
architects: ["PRD-005"]
impacts_paths: ["packages/server/tests/learning/**", "packages/server/scripts/**", "packages/server/*.json", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.ts"]
created_at: 2026-09-13
tags: ["architecture-decision", "saas", "stack"]
---

## Contexto

PRD-005 convierte prdm en un SaaS multi-organización con usuarios, permisos, edición colaborativa en tiempo real, versiones, comentarios, agente conversacional y MCP remoto. Hoy la única base es Neo4j Community (grafo por `project_id`, ADR-002), no hay identidad de usuario, ni cliente LLM, ni transporte MCP que no sea stdio. Runtime: Node 24 (ADR-005). Versiones verificadas con `npm view` el 2026-09-13.

## Opciones consideradas

| Tema | Opción | Pros | Contras |
|---|---|---|---|
| Datos relacionales | Neo4j para todo | Una sola base | Sin transacciones relacionales cómodas, sin RLS; usuarios, comentarios y logs de edición no son un grafo |
| Datos relacionales | **Postgres 18 + drizzle-orm 0.45.2 / drizzle-kit 0.31.10 / pg 8.23.0** | RLS nativo, advisory locks, funciones `SECURITY DEFINER`, SQL tipado, migraciones versionadas | Segunda base que operar |
| Auth | Hecho a mano (hash + sesiones) | Control total | Superficie de seguridad propia (reset, invitaciones, rate limit) |
| Auth | **better-auth 1.7.4** (adaptador drizzle, plugins organization y twoFactor) | Email/contraseña, sesiones, organizaciones, invitaciones, reset y TOTP probados | Expone muchos endpoints por defecto: exige allowlist y configuración endurecida (validada con learning test) |
| Tiempo real | Locks por documento + guardado por versiones | Simple | No es colaboración simultánea |
| Tiempo real | **yjs 13.6.32 + y-protocols 1.0.7 + @hocuspocus/server/provider 4.7.0** embebido con @fastify/websocket 11.3.0 | CRDT maduro; hooks de auth, `beforeSync`, persistencia y conexión de solo lectura; los rangos `(client, clock)` permiten atribución por carácter | API v4 a confirmar (learning test); una sola instancia en el MVP |
| Editor | TipTap 3.31.3 (rich text) | UX tipo documento | La ida y vuelta a Markdown normaliza listas y `- [ ]`: rompe `## Tareas` y los hashes de drift |
| Editor | **CodeMirror 6 (@codemirror/view 6.43.11, @codemirror/lang-markdown 6.5.2) + y-codemirror.next 0.3.6** | Edita el Markdown tal cual; orientado a líneas; soporta nonce de CSP | Menos WYSIWYG; se compensa con vista previa |
| SPA | **React 19.3.0 + Vite 8.3.0 + react-router 8.3.1 (modo data)** | Mismo stack que PRD-004; loaders/actions sin librería de caché extra | Primer router del repo |
| LLM | **DeepSeek `deepseek-v4-flash` vía openai 7.15.0 con `baseURL https://api.deepseek.com`** (decisión del usuario) | API compatible OpenAI (streaming, tools); clave de la plataforma | Proveedor externo procesa el contenido; el id del modelo se verifica con `GET /models` |
| MCP remoto | **@modelcontextprotocol/sdk 1.30.0 `StreamableHTTPServerTransport` sin estado** + proxy stdio `prdm mcp-proxy` | Reutiliza las tools por request; el proxy evita secretos en `.mcp.json` versionados | Semántica sin estado a validar (learning test) |
| Integridad del CI | **OIDC de GitHub Actions** verificado por el servidor | La rama y el evento los firma GitHub, no el cliente | Drift oficial solo desde GitHub Actions en el MVP |
| Seguridad HTTP | **@fastify/cookie 11.1.2, @fastify/csrf-protection 8.0.1, @fastify/rate-limit 11.2.0** | Plugins oficiales del framework de PRD-004 | — |
| Email | **nodemailer 10.0.9** + mailpit en dev | Estándar; transporte falso en tests | — |

## Decisión

El stack marcado en negrita. Postgres 18 con tag exacto de imagen fijado al implementar el compose. Una sola instancia de servidor (Fastify con Hocuspocus embebido) en el MVP. Neo4j Community sigue siendo el grafo, compartido entre organizaciones y aislado por `project_id` detrás de la autorización en Postgres; la búsqueda full-text ya filtra por proyecto (`buildScopedLuceneQuery`) y el sesgo de relevancia entre tenants se acepta.

Antes de construir sobre las APIs menos probadas se escriben **learning tests**, que se ejecutan después del scaffold de `packages/server`, el compose de Postgres y el harness de tests de SDD-006. Si Hocuspocus v4 no puede embeberse en Fastify, el plan B es un proceso separado detrás del mismo origen; ese plan B exige un RPC interno para `openDirectConnection` y el cierre de conexiones, y re-revisar SDD-008 y SDD-009.

## Consecuencias

- Servicios nuevos en `docker-compose.yml` (Postgres, Postgres de test, mailpit) y variables nuevas en `.env.example` (solo nombres).
- `DEEPSEEK_API_KEY` vive solo en `.env` / secretos del entorno; nunca en el repo ni en logs.
- El contenido de los documentos de cada organización se envía a DeepSeek: el agente es parte del producto, se informa al crear la organización y en el panel del agente, y no se desactiva en el MVP.
- En modo SaaS se reemplazan decisiones de ADR-002: D10 (marcador `graph-stale` → columna `graph_dirty` con outbox en Postgres), D12 (id asignado al commit → id reservado al crear el documento) y D15 (cierre de feature solo por CLI → también desde la UI por admin de proyecto con confirmación). El modo local conserva ADR-002 intacto.
- Escalar a varias instancias (extensión Redis de Hocuspocus, rate limit compartido) queda para un PRD posterior.

## Tareas

- [ ] Learning test de Hocuspocus 4.7.0 embebido en Fastify con @fastify/websocket 11.3.0: handleConnection, onAuthenticate con contexto, conexión readOnly, beforeSync, maxPayload y yDocOptions con gc false
- [ ] Learning test de better-auth 1.7.4 con adaptador drizzle y esquema propio descartable: allowlist de endpoints, sign-up público y allowUserToCreateOrganization deshabilitados, superadmin que crea organización e invita a su owner, baseURL fijo e identificadores de verificación hasheados, sobre el Postgres de test
- [ ] Learning test de StreamableHTTPServerTransport del SDK MCP 1.30.0 en modo sin estado montado en Fastify
- [ ] Learning test en navegador con Playwright de CodeMirror 6 con y-codemirror.next y de Cytoscape bajo una CSP con nonce de estilo y sin 'unsafe-inline', que documenta si hace falta otra estrategia de estilos
- [ ] Script manual de verificación de DeepSeek (GET /models confirma deepseek-v4-flash y una llamada con tools en streaming), excluido de CI y sin imprimir la clave
