---
id: "PRD-007"
title: "Conexión del frontend de Centurion Factory a la plataforma SaaS"
created_at: "2026-09-15"
tags: ["saas","frontend","integration","editor","drift"]
type: "PRD"
implements: []
evolves_from: ["PRD-006"]
justified_by: ["FB-007"]
status: "closed"
closed_at: "2026-09-16T11:02:38.409Z"
closed_by: "dev:tano"
---

## 1. Visión

PRD-006 dejó un rediseño de Centurion Factory aprobado en un canvas, corriendo solo con datos mock en `design/centurion-factory`. PRD-005 construyó, en paralelo, la plataforma SaaS real: organizaciones, permisos, documentos colaborativos, agente conversacional y MCP remoto. Hoy son dos productos que no se hablan: el diseño que el usuario aprobó vive aislado, y `packages/app` sigue mostrando sus pantallas originales contra la API real.

Este PRD une ambos: porta las pantallas aprobadas a `packages/app`, las conecta a la API de PRD-005, y llena los huecos que la investigación encontró en el camino — rutas que solo existían como herramientas MCP, agregados que nadie calculaba, y un defecto de integridad real: en modo SaaS, el motor nunca persiste qué código gobierna cada blueprint, así que el drift de código nunca se detecta de verdad ahí. El resultado es la Planta, el Árbol, las Órdenes y el Drift del diseño aprobado, mostrando el estado real de este mismo proyecto y de cualquier otro que use la plataforma — con un andon que se enciende por drift real, no por datos de muestra.

## 2. Alcance

**En alcance.**

Las doce pantallas del mapa de PRD-006 (Planta, Árbol de features, Documentos, Documento, Órdenes de trabajo, Drift, Bandeja de entrada, Login, Proyectos, Ajustes de miembros/tokens/SSO) se portan a `packages/app`, reemplazando sus pantallas actuales, y pasan a leer y escribir contra la API real bajo sesión y permisos por rol. Se agregan las pantallas que PRD-006 no contempló porque el mock no las necesitaba: reseteo de contraseña, aceptar invitación, verificación en dos pasos, panel de superadmin, perfil, tokens personales, auditoría, y la pantalla de revisión previa a publicar un documento (versión congelada, diff de frontmatter e `impacts_paths`, y de `## Tareas`).

El backend gana las rutas HTTP que hoy solo existen como herramientas MCP o no existen en absoluto: métricas del proyecto, búsqueda de nodos, rama completa de una feature, contexto/reclamar/completar de una orden de trabajo, enviar y triar feedback, un tablero de línea que deriva la estación real de cada feature y el andon desde issues de drift reales, un resumen agregado por proyecto (para Proyectos), detalle de un reporte de drift, listado de commits, lectura de audit log y reenvío de invitaciones.

Se corrige un defecto de integridad verificado en el código: `PgProjectEngine.buildDriftInput` siempre entrega un mapa de código gobernado vacío, así que cada sincronización reescribe la baseline sin nada dentro. El drift de código (`code_changed`) nunca puede dispararse en un proyecto SaaS, y las métricas de integridad del sistema quedan siempre en cero. Se agrega persistencia real de esa baseline, para que la sincronización en SaaS detecte drift como ya lo hace el modo local de este mismo repositorio.

La pestaña "Vista previa" del editor de documentos pasa a ser un editor real, no una simulación: edita el documento colaborativo verdadero (Yjs sobre Postgres) sin perder nada que el usuario no haya tocado. Soporta párrafos, títulos 1 a 3, listas simples, tareas, negrita, cursiva, tachado y enlaces con ediciones mínimas en offsets exactos del texto fuente; lo que no soporta se muestra como bloque de solo lectura con un acceso directo a editarlo en Markdown. Preserva la autoría por línea, los comentarios anclados y los hashes de drift. En pantallas móviles es de solo lectura.

El diseño aprobado se itera en el canvas con el usuario para las pantallas nuevas y para ajustar las reglas de estación a datos reales, antes de escribir código de pantalla. El E2E existente y la suite de aislamiento multi-tenant se actualizan para cubrir cada ruta y cada pantalla nueva.

**Fuera de alcance.** SSO, OIDC y SAML: el backend de PRD-005 no los implementa. El login conectado usa email y contraseña, con el paso de verificación en dos pasos ya existente cuando el usuario lo tiene habilitado; los botones de SSO del diseño y la pantalla de Ajustes › Autenticación y SSO quedan ocultos (FB-008 registra el pedido para un PRD futuro). Billing, planes, escalado horizontal y despliegue en la nube siguen fuera de alcance, como ya lo estaban en PRD-005. `design/centurion-factory` no se borra ni se rediseña: queda como referencia visual congelada, gobernada por ADR-007 y SDD-011. No se rediseña la colaboración en tiempo real más allá de lo que la Vista previa necesita: Hocuspocus, los límites de tamaño y tasa, y el modelo de autoría de SDD-008 no cambian.

## 3. Personas

Las mismas cinco de PRD-006, ahora con permisos y datos reales de su organización, en vez de un rol simulado por un selector.

**PM de producto.** Ve en la Planta la estación real de cada feature y el andon real. Tria feedback real en la Bandeja de entrada con los candidatos que sugiere el motor de búsqueda del grafo.

**Arquitecto o arquitecta.** Ve el código realmente gobernado por sus blueprints en el Árbol, y issues de drift reales cuando ese código cambia sin una orden que lo cubra.

**Developer senior.** Reclama y completa órdenes reales desde Órdenes de trabajo, con el commit verificado por el reporte de CI de su rama, no por un formulario libre.

**Agente de IA** (`agent:claude`, `agent:deepseek`). Sigue proponiendo ediciones sobre el documento real (SDD-009); la Vista previa nueva no cambia cómo el agente edita, solo cómo un humano edita a mano.

**Admin de proyecto.** Publica, reconoce drift real, cierra features reales y administra miembros, invitaciones y tokens de CI con las reglas de permisos de SDD-006.

## 4. Features principales

### 4.1 Tablero de línea con datos reales

La Planta deja de mostrar features de muestra: cada fila es una feature real del proyecto, su estación se deriva del estado real del grafo (justificación, aprobación, blueprints que la arquitectan, estado de sus órdenes), y el andon se enciende por un issue de drift real que afecta a esa estación.

**Casos de uso**
- La PM abre la Planta de `prdmanager` y ve `PRD-007` en Ejecución con 12 de 20 órdenes hechas. Ningún andon está encendido: el proyecto está sincronizado.
- El arquitecto revisa los KPIs reales: el porcentaje sincronizado de código gobernado ya no es 0%, porque la baseline de código ahora persiste.

**Criterios de aceptación**
- [ ] La estación de cada feature en la Planta coincide con la que muestra `prdm tree` para el mismo proyecto.
- [ ] Los KPIs se calculan con las métricas reales del proyecto (resolución mediana de órdenes, código sincronizado, trazabilidad de features y commits), no con datos de muestra.
- [ ] Un issue de drift de severidad error enciende el andon en la estación correcta según a qué apunta (una feature, un blueprint o una orden).
- [ ] `GET /api/app/organizations/:org/projects/:project/overview` no incluye ningún proyecto donde el usuario no tenga una fila de membresía.
- [ ] Con `awaitingFirstReport` en verdadero (ningún reporte de CI todavía), la Planta lo explica en vez de mostrar 0% de integridad como si fuera un dato real.

### 4.2 Vista previa editable sin pérdida del documento

El editor de Documento abre en Vista previa como en PRD-006, pero ahora edita el `Y.Text` real que comparten los colaboradores.

**Casos de uso**
- Un editor cambia una palabra en un párrafo desde Vista previa. Al mirar la pestaña Markdown, solo esa palabra cambió; el resto del archivo, carácter por carácter, sigue igual.
- Un documento con una tabla la muestra de solo lectura en Vista previa, con un botón "Editar en Markdown" que abre esa pestaña con el cursor ya ubicado en la tabla.

**Criterios de aceptación**
- [ ] Una edición en Vista previa produce, en el `Y.Text` del servidor, exactamente el splice esperado: ningún otro byte del documento cambia.
- [ ] El blame por línea sigue atribuyendo correctamente después de una edición hecha desde Vista previa.
- [ ] Un hilo de comentarios anclado a un párrafo sigue anclado en el lugar correcto después de editar ese párrafo desde Vista previa.
- [ ] Tablas, code fences, HTML, listas anidadas y encabezados h4 a h6 se muestran como bloque de solo lectura, nunca editable, en Vista previa.
- [ ] En una pantalla de 375 px, Vista previa es de solo lectura y ofrece el mismo acceso a Markdown.

### 4.3 Órdenes, drift y bandeja de entrada operables desde la interfaz

Lo que hoy solo se puede hacer con un code assistant por MCP pasa a poder hacerse desde el navegador, con los mismos permisos que ya rigen esas acciones.

**Casos de uso**
- Un developer filtra `pending` en Órdenes, abre `WO-341`, lee su contexto (objetivo, criterios, código gobernado) y la toma. Después de commitear y de que CI reporte, la completa pegando el SHA; el sistema la rechaza si ese commit todavía no llegó como baseline verificada por CI.
- La PM abre la Bandeja de entrada, ve un feedback nuevo con candidatos de feature sugeridos por puntaje, y lo enlaza al correcto.

**Criterios de aceptación**
- [ ] "Tomar orden" asigna siempre `dev:<handle del usuario>` o `agent:<nombre>`, nunca un texto libre.
- [ ] "Completar" exige un SHA y responde con un error explícito si ese commit no está verificado por CI en la rama por defecto.
- [ ] El detalle de un reporte de drift lista sus issues individuales, no solo el conteo.
- [ ] Triar un feedback generado (enviado por MCP) aplica el enlace de inmediato; uno creado a mano en el editor muestra que el enlace se aplicará al republicar el documento.
- [ ] "Reconocer drift" queda auditado con quién y cuándo.

### 4.4 Acceso y ajustes sobre autenticación real

El login, la sesión y los ajustes de organización y proyecto se conectan a better-auth y a los roles reales de SDD-006, con el diseño aprobado en PRD-006 donde aplica.

**Casos de uso**
- Alguien invitado recibe el email, entra a `/invite/:id`, fija su contraseña y queda dentro de la organización con el rol que le asignaron.
- Un admin de organización crea un token de CI con alcance `reports:write` y rama `main`, ve el secreto una sola vez, y lo revoca meses después desde la misma pantalla.

**Criterios de aceptación**
- [ ] El login es con email de trabajo y contraseña; si el usuario tiene verificación en dos pasos habilitada, pide el código antes de abrir sesión. No se muestra ningún botón de SSO.
- [ ] Reseteo de contraseña e invitación funcionan de punta a punta contra better-auth, incluidos sus límites de tasa.
- [ ] Miembros permite cambiar rol y quitar a otra persona (no a uno mismo), con la matriz de permisos de SDD-006.
- [ ] Tokens de CI y personales se crean, muestran el secreto una sola vez y se revocan.
- [ ] Auditoría lista las acciones del proyecto (o de la organización) con quién, cuándo y qué, sin exponer secretos en la metadata.
- [ ] Publicar un documento muestra la pantalla de revisión con la versión congelada, los cambios de frontmatter e `impacts_paths`, y de `## Tareas`, antes de confirmar.

### 4.5 Integridad de drift confiable en SaaS

Sin esta corrección, ninguna de las otras features muestra información real: el andon de código, los KPIs de integridad y la trazabilidad de código dependen de que la baseline de referencias de código realmente persista entre sincronizaciones.

**Casos de uso**
- Un developer cambia un archivo gobernado sin que ninguna orden lo cubra. El siguiente reporte de CI en la rama por defecto hace que la sincronización detecte `code_changed` para ese archivo, y el andon se enciende en la Planta.
- Un proyecto recién importado con `prdm link --import` conserva su baseline de código después del primer refresh, en vez de perderla como ocurre hoy.

**Criterios de aceptación**
- [ ] Después de dos reportes de CI en baseline con un hash de referencia distinto para el mismo archivo, la sincronización marca esa referencia `code_changed`.
- [ ] Un blueprint sin cambios entre dos sincronizaciones conserva su baseline exactamente igual.
- [ ] Neo4j proyecta nodos de código gobernado y su relación con el blueprint después de un reporte baseline.
- [ ] La métrica de integridad del sistema deja de ser 0/0 en un proyecto con al menos un reporte de CI baseline.
- [ ] Un reporte de vista previa (no baseline) nunca modifica la baseline persistida.

## 5. Mapa de pantallas

| Vista | Ruta | Qué cambia respecto a PRD-006 |
|---|---|---|
| Login | `/login` | Email y contraseña reales, sin botones de SSO |
| Reseteo de contraseña | `/reset-password` | Nueva; ronda de canvas |
| Aceptar invitación | `/invite/:id` | Nueva; ronda de canvas |
| Proyectos | `/o/:org` | Resumen agregado real por proyecto |
| Planta | `/o/:org/p/:project` | Estación y andon reales, KPIs reales |
| Árbol de features | `/o/:org/p/:project/arbol/:id?` | Trazabilidad con código gobernado real |
| Documentos | `/o/:org/p/:project/documents` | Lista real, filtros y creación reales |
| Documento | `/o/:org/p/:project/documents/:docId` | Vista previa editable sin pérdida, revisión de publicación |
| Órdenes de trabajo | `/o/:org/p/:project/ordenes` | Tomar/completar reales verificados por CI |
| Drift | `/o/:org/p/:project/drift` | Reporte oficial, previews e historial reales |
| Bandeja de entrada | `/o/:org/p/:project/entrada` | Feedback y triaje reales |
| Ajustes › miembros | `/o/:org/p/:project/ajustes/miembros` | Roles e invitaciones reales, con reenvío |
| Ajustes › tokens de CI | `/o/:org/p/:project/ajustes/tokens` | Tokens reales; sin el campo de rama (la baseline depende de OIDC y la rama por defecto) |
| Ajustes › tokens personales | `/o/:org/ajustes/tokens-personales` | Nueva; ronda de canvas |
| Ajustes › perfil | `/o/:org/ajustes/perfil` | Nueva; ronda de canvas |
| Ajustes › auditoría | `/o/:org/p/:project/ajustes/auditoria` y `/o/:org/ajustes/auditoria` | Nueva; ronda de canvas |
| Panel de superadmin | `/admin` | Nueva; ronda de canvas |

La pantalla de Ajustes › Autenticación y SSO de PRD-006 no se porta: queda documentada en FB-008 para cuando exista backend.

## 6. Flujos principales

**Reclamar y completar una orden con commit verificado por CI**
1. El developer filtra `pending` en Órdenes de trabajo y abre una.
2. Lee el contexto real (objetivo, criterios, código gobernado) y la toma; queda `in_progress` a su nombre.
3. Commitea con el trailer `Refs:` y pushea. CI reporta el commit como baseline en la rama por defecto.
4. Vuelve a la orden, pega el SHA y la completa. El sistema verifica que ese commit sea baseline y que su `Refs:` la incluya.
5. La orden pasa a `done`; si era la última que faltaba, el andon de esa feature se apaga en la Planta.

**Detectar drift real desde la Planta**
1. Un cambio de código sin orden asociada llega a la rama por defecto y CI lo reporta.
2. La sincronización compara contra la baseline persistida y encuentra `code_changed`.
3. El andon se enciende en la estación de Ejecución de la feature afectada.
4. El arquitecto entra al detalle del reporte, ve el issue, y usa "Reconocer drift" o crea una orden nueva para atenderlo.

**Editar un documento en Vista previa sin perder nada**
1. Un editor abre un documento en `in_review` y hace un cambio en un párrafo desde Vista previa.
2. Cambia a la pestaña Markdown: solo esa parte del archivo cambió.
3. Guarda; se crea una versión manual. El blame de esa línea muestra su nombre.
4. Un admin publica: la pantalla de revisión muestra el diff real de frontmatter y de `## Tareas` desde la última versión publicada.

## 7. Datos y compatibilidad

El contrato de tipos del mock (`design/centurion-factory/src/data/types.ts`) fue diseñado a propósito para parecerse a `@prdm/core` y a `@prdm/contracts`, así que la mayoría de las pantallas se conectan cambiando la fuente de datos, no la forma de los componentes. Donde el mock se adelantó a algo que el backend no tenía, este PRD lo agrega (SDD-012): estación por feature, resumen por proyecto, tablero de línea, inbox con candidatos, commits y detalle de reportes de drift.

Donde el mock modeló algo que el backend real no puede replicar así, la pantalla se adapta en la ronda de canvas de SDD-013, no se fuerza el dato: el `ProjectDocument.blocks` del mock no existe como tal (el cuerpo real es un único `Y.Text`), el campo `branch` de un token de CI no tiene equivalente (la baseline depende de OIDC más la rama por defecto del proyecto, no de un campo elegido al crear el token), y las propuestas del agente reales usan `expectedText`/`occurrence`/`replacement`, no la forma `section` del mock.

## 8. Calidad no negociable

Todo lo que PRD-006 ya exigía sigue vigente sobre el código real: responsive de 375 a 1440 px, foco visible por teclado, `prefers-reduced-motion` respetado, contraste WCAG AA, paleta solo en `tokens.css`. Se suma lo que corresponde a datos reales y a la superficie SaaS: ninguna ruta nueva se registra sin declarar su nivel de acceso; toda ruta de proyecto tiene una prueba cruzada de organización y de proyecto en la suite de aislamiento; ninguna acción mutante corre sin CSRF; los mensajes de error dicen qué pasó igual que en PRD-006 ("No pudimos verificar ese commit contra el último reporte de CI. Esperá el próximo reporte o revisá la rama."); el editor de Vista previa nunca usa `innerHTML` ni deja pasar una mutación de estilo que la CSP bloquearía de todos modos.

## 9. Métricas de éxito

- Cada ronda de canvas queda aprobada por el usuario antes de escribir el código de esa tanda de pantallas.
- Los criterios de aceptación de 4.1 a 4.5 se demuestran en el navegador contra el backend real corriendo local, no contra mocks.
- `packages/server/tests/isolation` pasa con cada ruta nueva probada en ambos sentidos (otra organización, otro proyecto de la misma organización).
- El E2E de `packages/server/tests/e2e/full-journey.spec.ts`, actualizado, cubre login, Planta, Documento (Vista previa y Markdown), publicación, órdenes y triaje de principio a fin.
- Cobertura ≥80% donde el `vitest.config.ts` raíz ya la exige.
- Cero violaciones de CSP (`securitypolicyviolation`) durante el E2E.
- `get_drift_report` muestra 0 issues bloqueantes al final de cada fase.

## 10. Orden de ejecución

1. **Gobernanza.** FB-007, FB-008, este PRD, ADR-008 (port a `packages/app`), ADR-009 (Vista previa sin pérdida), SDD-012 (API de backend), SDD-013 (port de frontend) y SDD-014 (editor de Vista previa).
2. **En paralelo:** fundamentos de SDD-012 (contratos, estaciones, la corrección de la baseline de código) y las rondas de canvas de SDD-013 con el usuario para las pantallas nuevas y las reglas de estación.
3. **En paralelo:** las rutas restantes de SDD-012, la capa de datos y el shell de SDD-013, y los módulos puros de SDD-014 (mapa de fuente, operaciones de edición).
4. **Pantallas,** cada una después de que su ruta esté disponible.
5. **Integración:** el editor de Vista previa se conecta a Documento, se actualiza el E2E, se retiran las pantallas viejas de `packages/app`.
6. **Revisión:** accesibilidad, seguridad y code review.
7. **Dogfooding:** este mismo repositorio importado a una instancia SaaS local, verificado contra `prdm tree`.
8. **Cierre.** Todas las órdenes en `done`, drift en 0, `prdm close PRD-007 --ack`.

## 11. Criterio de éxito

PRD-007 se cierra cuando:

- el usuario aprobó cada ronda de canvas de SDD-013,
- las doce pantallas del mapa corren en `packages/app` contra la API real y cumplen los criterios de 4.1 a 4.5 y la calidad no negociable,
- la corrección de la baseline de código gobernado está verificada con un reporte de CI real que produce `code_changed`,
- todas las órdenes de ADR-008, ADR-009, SDD-012, SDD-013 y SDD-014 están en `done` con commits trazados,
- `get_closure_readiness PRD-007` pasa sus cinco checks.
