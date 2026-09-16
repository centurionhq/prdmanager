---
id: "FB-007"
type: "FB"
title: "Conectar el frontend de Centurion Factory (PRD-006) al backend SaaS de PRD-005"
status: "new"
created_at: "2026-09-15"
source: "chat"
informs: ["PRD-006","PRD-005"]
---

## Feedback

El usuario pidió armar el próximo PRD para conectar el frontend rediseñado de Centurion Factory (PRD-006, en design/centurion-factory, aprobado y mergeado) al backend SaaS real que ya existe (PRD-005). Pidió investigar primero con prdmanager qué documentos y relación de código hay.

Investigación (MCP + exploración de código):
- El backend de PRD-005 (packages/server Fastify + packages/contracts + packages/db Postgres/RLS + Neo4j vía packages/core) ya expone por HTTP con sesión+CSRF: orgs, miembros, invitaciones, proyectos, tokens de CI y personales, documentos (CRUD, flujo, publicar, versiones, diff, restaurar, blame), comentarios, agente (SSE + propuestas), grafo (full/tree/node/work-orders), drift (inspect, reports oficial/preview/historial, acknowledge), closure-readiness y close.
- Faltan por HTTP (solo MCP hoy): métricas, búsqueda de nodos, feature branch, contexto/claim/complete de WO, submit/triage de feedback.
- Faltan por completo: estación de ciclo de vida por feature (necesaria para la Planta y el andon), agregados por proyecto (para Proyectos), transición new→triaged de la bandeja de entrada, listado de issues de un reporte de drift, listado de commits, lectura de audit log, reenvío de invitaciones, lastAccess de miembros.
- BUG DE CORRECCIÓN encontrado y verificado en el código: en modo SaaS, PgProjectEngine.buildDriftInput (packages/server/src/engine/pg-project-engine.ts:897) siempre pasa `governed: new Map()`, y reconcileBaseline (packages/core/src/sync/monitor.ts:271) reconstruye `governs` solo a partir de eso. Cada refresh borra la baseline de código. Efecto: `code_changed` nunca puede dispararse en SaaS, no hay CodeRef/GOVERNED_BY en Neo4j, systemIntegrity queda en 0/0, el contexto de WO no trae code[], y una baseline importada se pierde en el primer refresh.
- SSO no existe: better-auth solo tiene email/contraseña + TOTP para superadmins. El front nuevo tiene login SSO y una pantalla de Ajustes › SSO.
- El editor "Vista previa" del mock (design/centurion-factory) es lossy: pierde code fences, tablas, listas anidadas, CRLF, h4-6, blockquotes, y usa innerHTML (riesgo XSS con contenido remoto). No se puede portar tal cual sobre el Y.Text real de Yjs (ADR-006 ya había descartado TipTap por la misma razón: normaliza y rompe `## Tareas` y los hashes de drift).

Decisiones del usuario (2026-09-15), a preservar en el PRD:
1. Editor: la Vista previa sigue editable pero debe ser SIN PÉRDIDA — splices mínimos sobre Y.Text en offsets de origen exactos vía un nuevo ADR; lo no soportado se muestra como isla de solo lectura con "Editar en Markdown". El tab Markdown sigue siendo CodeMirror + Yjs tal cual está.
2. SSO queda fuera de este PRD. Login con email/contraseña (+TOTP) con el diseño nuevo; los botones de SSO y Ajustes › SSO se ocultan. Se registra un FB aparte para un futuro PRD de SSO.
3. El front conectado se porta a packages/app (reemplaza sus pantallas), no al revés. design/centurion-factory queda congelado como referencia visual, sin borrarse (ADR-007/SDD-011 lo siguen gobernando).

Esto justifica un nuevo PRD (PRD-007, evolves_from PRD-006) con blueprints ADR-008 (port a packages/app: tokens/fuentes/data layer/rutas), ADR-009 (vista previa editable sin pérdida sobre Y.Text, supersede parcialmente el renglón de editor de ADR-006), SDD-012 (API de backend nueva), SDD-013 (port de frontend con rondas de canvas), SDD-014 (editor de vista previa sin pérdida).
