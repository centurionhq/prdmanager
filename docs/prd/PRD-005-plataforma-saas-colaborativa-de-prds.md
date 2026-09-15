---
id: "PRD-005"
type: "PRD"
title: "Plataforma SaaS colaborativa de PRDs"
status: "closed"
created_at: "2026-09-13"
evolves_from: ["PRD-002"]
justified_by: ["FB-005"]
tags: ["saas", "collaboration", "auth", "realtime", "agent", "remote-mcp"]
closed_at: "2026-09-15T10:50:24.973Z"
closed_by: "agent:claude"
---

## 1. Visión

PRD-002 construyó un motor headless con autoría conversacional para un solo usuario por MCP, y PRD-004 un explorador web local de solo lectura. Este PRD convierte prdm en una **plataforma SaaS multi-organización** donde los equipos eligen un proyecto y escriben PRDs (y el resto de la gobernanza) **en colaboración y en tiempo real**, ayudados por un agente conversacional pero pudiendo editar a mano, con versiones, permisos, autoría por línea y comentarios. Lo publicado queda en el dashboard y **los developers lo toman con su code assistant a través del MCP remoto de prdm**, mientras el drift y la política `Refs:` siguen funcionando sobre sus propios repositorios.

## 2. Alcance

- **Plataforma y acceso:** organizaciones creadas por un superadmin de plataforma; usuarios con email y contraseña que entran por invitación con secreto de un solo uso; reseteo de contraseña; roles de organización (owner, admin, member) y de proyecto (admin, editor, developer, commenter, viewer); tokens personales y de CI con scopes; audit log; aislamiento entre organizaciones y entre proyectos garantizado en tres capas (repositorios con alcance, RLS de Postgres y suite de tests que recorre toda la superficie).
- **Dashboard:** selector de organización y proyecto, lista de documentos por tipo y estado, explorador del grafo y del drift reutilizando los componentes de PRD-004.
- **Documentos colaborativos:** edición simultánea (Yjs + CodeMirror 6 sobre el Markdown y formulario del frontmatter), validación en vivo con el core, flujo `draft → in_review → published → archived`, publicación por admin de proyecto sobre una versión concreta, reconocimiento de drift, versiones con diff y restauración, autoría por línea no falsificable, comentarios en hilos anclados al texto.
- **Agente conversacional:** chat por documento con DeepSeek `deepseek-v4-flash`; consulta el documento y el grafo del proyecto y **propone** cambios que un editor acepta o rechaza; lo aceptado queda atribuido al agente en nombre de quien lo aceptó.
- **Developers:** MCP remoto (Streamable HTTP) con tokens; `prdm login`, `prdm link` (con `--import` para subir un repo prdm existente) y `prdm sync` remoto que reporta el estado del código; **drift oficial solo desde GitHub Actions en la rama por defecto, verificado con OIDC**; política `Refs:` con documentos obtenidos del SaaS y caché offline.
- **Plataforma técnica:** Node 24 LTS (ADR-005) y el stack SaaS de ADR-006 (Postgres 18 junto a Neo4j, better-auth, Hocuspocus, DeepSeek vía SDK openai).

**Fuera de alcance:** billing y planes; SSO/OAuth; otros proveedores de LLM y desactivar el agente por organización; notificaciones (salvo invitaciones y reseteo de contraseña) y menciones; escalado horizontal (Redis, varias instancias); escribir en los repositorios git de las organizaciones; indexar su código en el servidor; exigir `Refs:` entre repos; reportar drift oficial desde CIs distintos de GitHub Actions; despliegue en la nube.

## 3. Orden de ejecución

ADR-005 (Node 24) → SDD-006 tareas de scaffold, compose y harness → ADR-006 (learning tests) → resto de SDD-006 → SDD-007 → SDD-008 → SDD-009 → SDD-010. Cada fase cierra con su compuerta de revisión (arquitectura, seguridad y, donde aplica, rendimiento o accesibilidad) antes de avanzar, y los hallazgos entran como tareas nuevas del blueprint correspondiente.

## 4. Criterio de éxito

Un superadmin crea una organización e invita a su owner, que invita a dos usuarios; ambos editan el mismo PRD a la vez desde navegadores distintos, ven la autoría de cada línea, dejan y resuelven comentarios, aceptan una propuesta del agente, y un admin lo publica junto a un SDD que genera WOs. Un developer con `prdm link` lista y reclama un WO desde su code assistant, lo implementa, y tras el reporte de GitHub Actions en la rama principal lo completa y el drift oficial queda en 0. Este repositorio se importa al SaaS con `prdm link --import` sin perder ids, estados ni hashes. La suite de aislamiento está verde, la clave del LLM y los secretos de invitación y reseteo nunca aparecen en logs, la cobertura es ≥80%, el E2E de Playwright pasa en CI y la feature se cierra con `prdm close PRD-005 --ack`.
