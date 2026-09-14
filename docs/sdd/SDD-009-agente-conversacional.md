---
id: SDD-009
type: SDD
title: "Agente conversacional de autoría con DeepSeek y propuestas de edición atribuidas"
status: active
architects: ["PRD-005"]
impacts_paths: ["packages/server/src/**", "packages/server/tests/**", "packages/server/*.json", "packages/contracts/src/**", "packages/contracts/tests/**", "packages/collab/src/**", "packages/collab/tests/**", "packages/db/src/**", "packages/db/tests/**", "packages/db/migrations/**", "packages/app/src/**", "packages/app/tests/**", "packages/app/*.json", "packages/mcp/src/**", ".env.example", "README.md", "package.json", "package-lock.json"]
created_at: 2026-09-13
tags: ["saas", "agent", "llm", "deepseek", "security"]
---

## Contexto

PRD-005 pide que la autoría esté asistida por un agente conversacional sin impedir la edición manual. Hoy el único flujo conversacional es el prompt `author_artifact` del MCP local, que depende del code assistant del usuario. En el SaaS el agente corre del lado del servidor con **DeepSeek `deepseek-v4-flash`** y la clave de la plataforma (ADR-006), siempre activo. La colaboración, la atribución y las transacciones de servidor son de SDD-008.

## Diseño

- **Puerto `LlmClient`** `streamChat({messages, tools, maxTokens, signal}) → AsyncIterable<LlmEvent>`:
  - `DeepSeekClient`: `new OpenAI({apiKey: env.DEEPSEEK_API_KEY, baseURL: env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', maxRetries: 1, logLevel: 'warn', logger: <logger que redacta>})` y `chat.completions.create({model: env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash', stream: true, tools})` con openai 7.15.0.
  - `FakeLlmClient` guionado, inyectado por `buildServer`; es el único usado en tests y E2E. No se habilita por variable de entorno en `main.ts`.
- **Endpoint** `POST /api/app/orgs/:org/projects/:project/documents/:docId/agent/messages` (sesión + CSRF, **editor o superior**) con respuesta `text/event-stream`: `message_start`, `token`, `tool_call`, `tool_result`, `proposal`, `usage`, `done`, `error`. Una transmisión activa por usuario; cortar el request aborta con `AbortController`. El cliente la lee con `fetch` + `ReadableStream`.
- **Conversaciones privadas:** cada conversación es por documento y visible solo para su dueño.
- **Herramientas** (zod, atadas al proyecto y a los permisos de quien pregunta, re-leídos en cada llamada, salidas acotadas a ~20 KB): `read_document` (copia de trabajo con números de línea), `search_project`, `get_node`, `get_feature_branch`, `get_template`, `validate_document` y `propose_edit`. Ninguna recibe ids de organización o proyecto, no hay herramientas de red ni de archivos. Al proveedor se envían handles, nunca emails ni ids de usuario.
- **Bucle:** máximo 8 iteraciones de tools, tope de tokens por turno, historial reenviado acotado, cancelable.
- **Propuestas, no ediciones:** `propose_edit({summary, edits: [{expectedText, occurrence?, replacement}], fields?: {set, unset}})` resuelve cada `expectedText` en la copia actual a `Y.RelativePosition` (helpers de `packages/collab`), rechaza ediciones solapadas y campos prohibidos (`forbiddenFieldInjectionIssues`) y guarda la propuesta `pending` con el state vector base y quién la pidió. **El agente nunca modifica el documento.**
- **Aceptar** (editor+): re-resuelve las anclas y re-valida campos; si el texto ya no coincide, la propuesta pasa a `stale` (la UI ofrece pedir una nueva). Si coincide, aplica todo en una transacción de servidor de SDD-008 con actor `{agent_id: 'agent:deepseek', on_behalf_of: <quien acepta>, requested_by: <quien pidió>, proposal_id}`, crea versión `agent_accept` y audita. **Rechazar** guarda quién y cuándo.
- **Persistencia:** `agent_conversations`, `agent_messages` (rol, contenido, tool calls, tokens, modelo), `agent_proposals`, `llm_usage` (por organización y día), todas con `org_id`, FKs compuestas y RLS.

## Seguridad y costo

- **Inyección de prompts:** cuerpo del documento, nodos del grafo, comentarios y feedback entran en bloques cercados con etiqueta aleatoria y `<`/`>` escapados (`fenceTag` y `escapeFenceChars` de `@prdm/mcp/lib`, SDD-007); el prompt de sistema declara que lo cercado es dato. Como un cambio aceptado llega luego al code assistant de los developers, las tarjetas de propuesta muestran por separado los cambios de frontmatter (en especial `impacts_paths`) y de `## Tareas`, y la pantalla de publicación de SDD-007 lista los links y comandos agregados desde la última versión publicada. La revisión humana de toda edición es la salvaguarda final.
- **Salida del agente:** se renderiza con el mismo pipeline de react-markdown del editor: sin HTML crudo, sin imágenes remotas (evita exfiltración por URL), links externos con la URL completa visible y `rel="noopener noreferrer"`; CSP `img-src 'self' data:`.
- **Secretos:** `DEEPSEEK_API_KEY` solo en `.env` o secretos del entorno, leída una vez por el esquema de entorno, redactada del logger; los errores del SDK se mapean a `{code: 'llm_error'}` con mensaje fijo. Un test verifica que la clave no aparece en logs ni respuestas.
- **Cuotas:** tope diario de tokens y requests por organización (`PRDM_AGENT_DAILY_TOKENS_PER_ORG`), tope global diario con corte automático para proteger la clave compartida (`PRDM_AGENT_DAILY_TOKENS_GLOBAL`), reserva de tokens antes de llamar (los turnos concurrentes no exceden la cuota) y rate limit por usuario (`PRDM_AGENT_RPM_PER_USER`); excedido devuelve 429 `rate_limited`.
- El contenido de cada organización se procesa en DeepSeek (decisión de producto de PRD-005); se informa al crear la organización (SDD-006) y en el panel del agente.

## UI

Panel "Agente" del editor: historial de las conversaciones propias, streaming de la respuesta, llamadas a herramientas plegables y tarjetas de propuesta con diff (frontmatter y `## Tareas` destacados), aceptar y rechazar.

## Tests

Todo con `FakeLlmClient`: bucles de varias tools, intentos de inyección desde documento y comentarios, propuestas con campos prohibidos o solapadas, aborto, cuotas por organización, global y concurrentes. `DeepSeekClient` contra un servidor local que emite chunks SSE estilo OpenAI. Integración de aceptar propuestas contra el servidor de colaboración con blame esperado. Salida con imágenes remotas y HTML. Sin red en ningún test; la verificación real del modelo es el script manual de ADR-006.

## Tareas

- [ ] Puerto LlmClient con FakeLlmClient guionado y DeepSeekClient sobre openai 7.15.0 con baseURL, modelo, maxRetries y logger que redacta desde el entorno, con test de contrato contra servidor SSE falso
- [ ] Tablas agent_conversations, agent_messages, agent_proposals y llm_usage con FKs compuestas, RLS y migración
- [ ] Herramientas del agente acotadas a proyecto y permisos (read_document, search_project, get_node, get_feature_branch, get_template, validate_document) con límites de tamaño y sin datos personales, con tests
- [ ] Prompt de sistema y cercado de datos no confiables con fenceTag y escapeFenceChars, con tests de inyección desde documento y comentarios
- [ ] Bucle del agente con máximo de iteraciones, historial acotado, AbortSignal y tope de tokens, con tests con FakeLlmClient
- [ ] Endpoint de mensajes con respuesta SSE para editor o superior, CSRF, conversaciones privadas y una transmisión activa por usuario, con tests
- [ ] propose_edit que resuelve el texto esperado a Y.RelativePosition, rechaza ediciones solapadas y campos prohibidos y guarda propuestas pendientes, con tests
- [ ] Aceptar y rechazar propuestas con detección de stale, aplicación como transacción de servidor atribuida a agent:deepseek en nombre de quien acepta, versión y auditoría, con tests de blame
- [ ] Cuotas por organización, tope global con corte, reserva de tokens y rate limit por usuario con errores del proveedor saneados y test de que la clave no aparece en logs
- [ ] Panel de chat del agente con streaming, salida sin HTML ni imágenes remotas y tarjetas de propuesta con diff que destacan frontmatter y Tareas, con tests
- [ ] Deshabilitar el requestTimeout/headersTimeout por defecto de Node (5 min) en la conexión SSE de .../agent/messages: verificado con la clave real que este modelo puede tardar varios minutos en producir el primer token útil incluso en una respuesta trivial, con test de que se llama setTimeout(0) al iniciar el stream
- [ ] Revisión de seguridad #3 (HIGH): propose_edit y la aceptación de propuestas deben respetar el mismo freeze de solo lectura que ya aplica a la edición humana (documento archivado o de origin generated), tanto al crear la propuesta como al aceptarla, con tests de ambos casos
- [ ] Revisión de seguridad #3 (MEDIUM): test de concurrencia real (Promise.all) contra Postgres real para la aceptación simultánea de la misma propuesta, verificando que solo una gana y la otra recibe conflicto
