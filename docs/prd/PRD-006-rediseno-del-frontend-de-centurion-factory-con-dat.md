---
evolves_from: ["PRD-005"]
justified_by: ["FB-006"]
tags: ["design","frontend","mock","canvas"]
id: "PRD-006"
type: "PRD"
title: "Rediseño del frontend de Centurion Factory con datos mock"
status: "approved"
created_at: "2026-09-15"
---

## 1. Visión

Centurion Factory (prdm) es una **fábrica de software**. El feedback y los artifacts justifican features (MRD, PRD, FR). Los blueprints (SDD, ADR) las diseñan, las work orders las ejecutan, los commits con `Refs:` las resuelven y el código gobernado queda sincronizado o fuera de sincronía con su blueprint. PRD-005 llevó todo eso a una plataforma SaaS colaborativa, pero su dashboard es un conjunto funcional de formularios y tablas planas. Nadie ve de un vistazo en qué estación del ciclo de vida está cada feature, dónde se frenó la línea ni por qué.

Este PRD rediseña el frontend **solo con datos mock**, usando el mundo de una planta como ancla visual:

- **La línea:** las seis estaciones del ciclo de vida de PRD-002 (Ingesta, Definición, Diseño, Planificación, Ejecución y Cierre), por las que avanza cada feature.
- **El andon:** la lámpara de parada de línea. Marca el drift: la estación donde algo se frenó y el motivo.
- **Cianotipo:** el color de los blueprints, que en este producto lo son literalmente.
- **Trazabilidad de lote:** la cadena que une un feedback con el código que lo resolvió.

**Por qué ahora.** Con PRD-005 cerrado, el grafo real tiene 292 documentos, 261 work orders y 3.254 referencias de código gobernado. El volumen ya no se lee en tablas. Diseñar la experiencia antes de conectarla permite iterar rápido con el usuario, sin arrastrar el backend. Si el diseño se aprueba, **un PRD posterior lo conecta** a la API de PRD-005.

## 2. Alcance

**En alcance**

- **Siete vistas de trabajo** en un paquete aislado (`design/centurion-factory`, ADR-007): Planta, Árbol de features, Documentos, Documento, Órdenes de trabajo, Drift y Bandeja de entrada.
- **Acceso y ajustes:** login con SSO primero (email de trabajo, Google Workspace, Microsoft Entra ID) y contraseña como alternativa, selección de proyectos de la organización, y ajustes de miembros y roles, tokens de CI y autenticación/SSO de la organización.
- **Interactividad sin backend:** navegación, búsqueda, filtros, orden, modales, drawers, toasts y cambios de estado en memoria.
- **Datos mock realistas** con ids y títulos reales del grafo y estados de muestra, más estados de interfaz cargando, vacío y error en todas las vistas.
- **Diseño iterado primero en un canvas** con el usuario (direcciones, alta fidelidad y aprobación). El código React implementa el canvas aprobado.
- **Tokens de diseño y reglas** documentados en el `CLAUDE.md` del paquete, para reutilizarlos en el PRD de conexión.

**Fuera de alcance**

- Backend, APIs, base de datos, autenticación real, SSO real y permisos reales. El rol del usuario se simula con un selector. SSO no existe en el backend de PRD-005 (quedó fuera de su alcance): acá es solo diseño, y conectarlo pertenece al PRD posterior.
- Colaboración en tiempo real y LLM real: las propuestas del agente son datos mock.
- Portar las pantallas a `packages/app` o reemplazar el dashboard actual.
- Despliegue, notificaciones, billing e i18n (la interfaz es solo en español).

## 3. Personas

**PM de producto.** Define y prioriza features, y responde por el roadmap.
- *Necesita* ver qué está implementado, qué está en curso y qué se frenó, y llegar en un clic al documento o a la orden que lo explica.
- *Dolor:* hoy tiene que abrir cada documento para reconstruir su estado. Preguntar "¿dónde se frenó la línea?" implica leer el reporte de drift entero.

**Arquitecto o arquitecta.** Escribe SDD y ADR y cuida que el código gobernado respete el blueprint.
- *Necesita* saber qué código quedó fuera de sincronía, qué órdenes quedaron `out_of_sync` cuando cambió un blueprint, y reconocer el drift revisado.
- *Dolor:* el drift aparece como una lista de issues sin contexto de feature ni de estación, y el reconocimiento vive en un formulario suelto.

**Developer senior.** Toma órdenes y las resuelve con commits.
- *Necesita* el paquete de contexto completo (feature, blueprint, criterios, código gobernado, historia) antes de escribir código, y saber qué órdenes son suyas.
- *Dolor:* reconstruye contexto en cada ticket y no ve la cadena hacia atrás, del código a la feature.

**Agente de IA** (`agent:claude`, `agent:deepseek`). Resuelve órdenes y propone ediciones. Es consumidor del grafo, y los humanos supervisan su trabajo desde la interfaz.
- *Necesita* que sus propuestas se presenten con un diff claro y que lo aceptado quede atribuido: "Agente (aceptado por Ana)".
- *Dolor:* sin una buena presentación, sus propuestas se rechazan por desconfianza o se aceptan sin leerlas.

**Admin de proyecto.** Publica documentos, reconoce drift y cierra features.
- *Necesita* acciones de flujo claras (pedir revisión, publicar, archivar) y un cierre de feature que muestre por qué está o no lista.
- *Dolor:* los checks de cierre y los permisos por rol no se ven hasta que una acción falla.

## 4. Features principales

### 4.1 Planta: tablero de línea con andon de drift

La vista raíz muestra la línea con las features en curso como filas que avanzan por las seis estaciones. Cada fila indica la estación actual, las órdenes hechas sobre el total y, si hay drift, el andon encendido con el motivo. Debajo están los KPIs del grafo, el drift reciente y las órdenes en curso.

**Casos de uso**
- La PM abre la Planta, ve el andon encendido en Ejecución sobre `FR-002` y entiende que tres órdenes quedaron fuera de sincronía porque cambió `SDD-012`. Desde ahí va al drift de esa feature.
- El arquitecto revisa los KPIs: código sincronizado, features trazadas, commits con `Refs:` y resolución mediana. Con eso decide si hay que frenar para sanear.

**Criterios de aceptación**
- [ ] Las seis estaciones se muestran en orden y en sentence case. En 375 px se apilan en vertical sin scroll horizontal.
- [ ] Cada feature muestra id, título, estación actual y órdenes hechas sobre el total. Una feature cerrada se ve atenuada.
- [ ] Una feature con drift de severidad error enciende el andon en su estación con un texto que dice qué pasó ("3 órdenes fuera de sincronía"). El andon es el único uso del amarillo de alerta.
- [ ] Hacer clic en una fila, o Enter con foco en ella, lleva a su nodo en el Árbol. Hacer clic en el andon lleva a Drift filtrado por esa feature.
- [ ] Los KPIs usan los campos reales de métricas: `medianResolutionHours`, `syncedPercent`, `featurePercent` y `commitPercent`.
- [ ] Al cargar, las estaciones se encienden de izquierda a derecha, las filas se ubican y el andon se enciende último. Con `prefers-reduced-motion` se muestra directamente el estado final.
- [ ] Con `?estado=cargando`, `?estado=vacio` y `?estado=error` se ven skeleton, vacío con acción sugerida y error con "Reintentar".

### 4.2 Autoría asistida de documentos

La vista Documento reúne en una pantalla:

- el editor, que abre en **Vista previa** editable como un editor de texto común (párrafo, títulos 1 a 3, negrita, cursiva, tachado, listas, tareas y enlace) y ofrece **Markdown** como segundo tab para tocar el fuente directo, junto al formulario de frontmatter,
- el flujo `draft → in_review → published → archived`,
- la propuesta del agente con diff,
- los hilos de comentarios,
- las versiones con restaurar,
- el panel de validación.

La lista de Documentos permite buscar, filtrar por tipo y estado, ordenar y crear un documento.

**Casos de uso**
- La PM abre `PRD-006` en `draft`. Acepta la propuesta del agente sobre la sección de visión, responde un comentario, guarda y pide revisión.
- La admin abre un SDD en `in_review`, ve cero errores de validación y lo publica. El documento muestra una nueva versión con motivo "published".

**Criterios de aceptación**
- [ ] El editor abre en "Vista previa". La barra de formato aplica párrafo, título 1 a 3, negrita, cursiva, tachado, listas, tareas y enlace sobre la selección, y el tab "Markdown" muestra el mismo contenido como fuente, sincronizado en ambos sentidos.
- [ ] "Guardar" muestra el toast "Guardado", anunciado por una región `aria-live`, y agrega una versión manual al historial.
- [ ] Las acciones de flujo dependen del estado y del rol simulado. Un `viewer` no ve "Publicar" y un `editor` no puede publicar. Toda transición muestra un toast con el resultado.
- [ ] La propuesta del agente muestra un resumen y un diff por edición, con "Aceptar" y "Rechazar". Al aceptarla, el texto cambia y la autoría figura como "Agente (aceptado por Ana)". Una propuesta `stale` explica que el texto cambió y no se puede aceptar.
- [ ] Los comentarios citan el texto anclado y permiten responder y resolver. Los hilos resueltos se ocultan con un filtro.
- [ ] Las versiones muestran número, motivo, autor y fecha. "Restaurar" pide confirmación en un modal y agrega una versión con motivo "restore".
- [ ] El panel de validación lista issues con severidad, campo y mensaje. Con errores, "Publicar" queda deshabilitado y dice por qué.
- [ ] "Nuevo documento" abre un modal con tipo (todos menos WO) y título, valida en línea y crea el documento en memoria.
- [ ] En 375 px, los paneles laterales pasan a pestañas.

### 4.3 Órdenes de trabajo y trazabilidad

La vista Órdenes lista las work orders con filtros, búsqueda y orden. El detalle se abre en un drawer con objetivo, criterios, blueprint, código gobernado y commits, y ofrece "Tomar orden" y "Completar". El Árbol de features muestra la cadena completa del nodo seleccionado y el modal "Cerrar feature" con los cinco checks de cierre.

**Casos de uso**
- Un developer filtra `pending` en `SDD-011`, abre `WO-275`, lee los criterios y la toma. La orden pasa a `in_progress` asignada a `dev:martin`.
- La admin abre `PRD-004` en el Árbol, recorre la cadena desde `FB-004` hasta los code refs y abre "Cerrar feature": los cinco checks están en verde.

**Criterios de aceptación**
- [ ] La tabla muestra id, título, blueprint, estado, asignación y fecha, y ordena por cualquier columna con `aria-sort`.
- [ ] Los filtros de estado (`pending`, `in_progress`, `done`, `out_of_sync`), blueprint y tipo de actor (agente o dev) se combinan con la búsqueda por id o título. Sin resultados, se ve "Ninguna orden coincide con estos filtros" con "Quitar filtros".
- [ ] "Tomar orden" pide el asignado (`agent:` o `dev:`) y mueve la orden a `in_progress`. "Completar" pide el SHA del commit con `Refs:` y la mueve a `done`. Una orden `out_of_sync` explica qué blueprint cambió.
- [ ] El Árbol se navega con teclado (flechas, Home, End, expandir y colapsar) y usa `role="tree"`.
- [ ] El panel de trazabilidad muestra, para el nodo elegido, FB y ART → feature → blueprints → órdenes → commits → code refs, con estado de sincronía.
- [ ] "Cerrar feature" lista `feature_exists`, `feature_approved`, `blueprints_have_work_orders`, `work_orders_done` y `project_clean` con su detalle. Solo habilita el cierre cuando todos pasan.
- [ ] En 375 px, la tabla se apila en filas legibles y el drawer ocupa la pantalla completa.

### 4.4 Acceso y ajustes

Antes de la línea hay una puerta: la persona entra a su organización, elige un proyecto y, si es admin, gestiona quién accede y cómo.

**Casos de uso**
- Julia escribe su email de trabajo, elige "Continuar con SSO" y la app la manda al proveedor de Centurion HQ. Después ve sus proyectos con la salud de cada línea y entra a prdmanager.
- Ana invita a una persona como developer, crea un token de CI para la rama por defecto y exige SSO para toda la organización.

**Criterios de aceptación**
- [ ] El login ofrece SSO primero (email de trabajo, Google Workspace, Microsoft Entra ID) y "Usar email y contraseña" como alternativa. Credenciales inválidas muestran "Email o contraseña incorrectos" con cómo seguir, y el SSO muestra a qué proveedor redirige.
- [ ] La selección de proyectos lista los proyectos de la organización con estado de la línea, drift, órdenes en curso, rol y última actividad, filtra activos y archivados, y se navega con teclado.
- [ ] El sidebar tiene selector de proyecto y acceso a Ajustes, con subnavegación de proyecto, organización y cuenta.
- [ ] Miembros permite cambiar el rol, quitar a otra persona (no a uno mismo), reenviar o revocar invitaciones e invitar con un modal que confirma "Invitación enviada". La matriz de roles coincide con los permisos del producto.
- [ ] Tokens de CI muestra el secreto una sola vez al crearlo, con alcance, rama, vencimiento (máximo 90 días), último uso y revocación.
- [ ] Autenticación y SSO configura proveedor OIDC o SAML, dominios verificados con su registro TXT, reglas de acceso (exigir SSO, alta automática con rol por defecto, acceso de emergencia) y "Probar conexión"; "Guardar cambios" confirma "Guardado".
- [ ] Login, selección de proyectos y ajustes funcionan a 375 px.

## 5. Mapa de pantallas

| Vista | Ruta | Qué resuelve |
|---|---|---|
| Planta | `/` | Dónde está cada feature y dónde se frenó la línea. Salud del grafo. |
| Árbol de features | `/arbol/:id?` | Jerarquía MRD → PRD → FR, trazabilidad del nodo y cierre de feature |
| Documentos | `/documentos` | Encontrar y crear documentos por tipo y estado de flujo |
| Documento | `/documentos/:id` | Escribir, revisar, aceptar al agente, comentar, versionar y publicar |
| Órdenes de trabajo | `/ordenes` | Encontrar, tomar y completar órdenes con su contexto |
| Drift | `/drift` | Reporte oficial, previews por rama, historial, issues por tipo y reconocimiento |
| Bandeja de entrada | `/entrada` | Triar feedback y artifacts nuevos y enlazarlos a una feature |
| Login | `/login` | Entrar a la organización con SSO o contraseña |
| Proyectos | `/proyectos` | Elegir proyecto viendo la salud de cada línea |
| Ajustes · miembros | `/ajustes/miembros` | Roles, invitaciones y qué puede hacer cada rol |
| Ajustes · tokens de CI | `/ajustes/tokens` | Crear, ver una vez y revocar tokens de CI |
| Ajustes · autenticación y SSO | `/ajustes/sso` | Proveedor de identidad, dominios y reglas de acceso de la organización |

Las vistas de trabajo y los ajustes comparten el shell: sidebar con selector de proyecto en desktop, barra inferior en mobile, búsqueda global y selector de rol simulado. Login y Proyectos quedan fuera del shell de proyecto.

## 6. Flujos principales

**Detectar y reconocer drift desde la Planta**
1. La arquitecta abre la Planta y ve el andon encendido en Ejecución sobre `FR-002`.
2. Hace clic en el andon y llega a Drift filtrado por `FR-002`: dos `code_out_of_sync` y un `work_order_out_of_sync` causado por `blueprint_changed` en `SDD-012`.
3. Abre el issue y lee la ruta afectada, el blueprint y la orden.
4. Vuelve al reporte y usa "Reconocer drift" con el objetivo `SDD-012`.
5. El modal pide confirmación y explica que la línea base avanza. Al confirmar, se ve el toast "Drift reconocido" y el andon se apaga en la Planta.

**Revisar y publicar un documento aceptando una propuesta del agente**
1. La PM abre Documentos, filtra `in_review` y abre `SDD-011`.
2. En el panel del agente, lee la propuesta "Agregar la tarea de capturas a 375 px" y su diff.
3. Acepta la propuesta: el texto cambia y la autoría muestra "Agente (aceptado por Ana)".
4. Resuelve el hilo de comentarios que pedía esa tarea.
5. Guarda y ve el toast "Guardado".
6. Con validación en cero errores y rol admin, publica. El estado pasa a `published` y aparece la versión con motivo "published".

**Tomar y completar una orden**
1. El developer abre Órdenes, filtra `pending` y blueprint `SDD-011`.
2. Abre `WO-275` en el drawer y lee objetivo, criterios y código gobernado.
3. Elige "Tomar orden", confirma `dev:martin` y ve el toast "Orden tomada".
4. Tras commitear, elige "Completar", pega el SHA y confirma.
5. La orden pasa a `done` y el panel de trazabilidad muestra el commit.

**Triar un feedback y enlazarlo a una feature**
1. La PM abre la Bandeja de entrada y ve `FB-007` en estado `new`, con fuente y cliente.
2. Lee el texto y usa "Enlazar a feature". El modal sugiere `FR-003` como candidata.
3. Confirma: `FB-007` pasa a `triaged` con `informs: FR-003`, desaparece de pendientes y aparece en la trazabilidad de `FR-003`.

## 7. Datos mock y estados

- **Tipos:** modelan `@prdm/core` (dominio) y `@prdm/contracts` sin importarlos.
- **Ids y títulos:** reales del grafo (`PRD-005`, `SDD-010`, `WO-143 "Cierre de feature con closureReadiness…"`) más ids de muestra que continúan la numeración (`FR-002`, `FR-003`, `SDD-012`, `WO-268…`).
- **Estados de muestra:** el grafo real está 100 % sincronizado, así que se inventan estados para ejercitar cada vista.
- **Volúmenes:**

  | Entidad | Registros |
  |---|---|
  | Features | 12 |
  | Blueprints | 16 |
  | Work orders | 40 |
  | Documentos | 20, con 3 a 6 versiones y 0 a 4 hilos cada uno |
  | Issues de drift | 14, de todos los tipos y severidades |
  | Feedback y artifacts | 14 |
  | Commits | 24 |
  | Miembros con roles | 8 |
  | Propuestas del agente | 3 (pendiente, aceptada, stale) |

- **Estados de interfaz:** `?estado=cargando|vacio|error` funciona en cualquier vista, y el primer render de cada lista simula latencia con skeleton.

**Copy**
- Voz activa y sentence case.
- El botón dice lo que hace ("Tomar orden") y el toast confirma el resultado ("Orden tomada").
- Los errores dicen qué pasó y cómo seguir: "No pudimos leer el reporte de CI de `feat/sdd-012`. Reintentá o revisá que el token `prdm_ci_…` siga vigente."
- Los vacíos proponen la próxima acción: "Todavía no hay feedback sin triar. Lo nuevo llega desde el MCP o la CLI."

## 8. Calidad no negociable

- **Responsive:** 375 px a 1440 px, sin scroll horizontal.
- **Foco:** visible por teclado en todo control. Los modales devuelven el foco y cierran con Esc.
- **Motion:** se respeta `prefers-reduced-motion`. Hay un único momento de motion orquestado (la carga de la Planta).
- **Contraste:** WCAG AA en todo par de texto, verificado por test sobre los tokens.
- **Paleta:** armónica y definida solo en `tokens.css`, con cero hex fuera de ese archivo, verificado por test.
- **Tipografía:** con intención (ADR-007) y monospace solo para identificadores literales.

## 9. Métricas de éxito

- **Canvas aprobado** por el usuario antes de escribir código de pantallas.
- **Prueba de pasillo:** alguien que no conoce la app responde "¿dónde se frenó la línea y por qué?" en menos de 5 s desde la Planta.
- **Criterios demostrables:** el 100 % de los criterios de 4.1 a 4.4 se demuestra en el navegador sin backend.
- **Estados:** las vistas de trabajo tienen estado cargando, vacío y error.
- **Calidad medida:** Lighthouse Accessibility ≥ 95 en todas las vistas, 0 fallos de contraste AA y 0 hex fuera de tokens.
- **Verificación del paquete:** `npm run typecheck`, `npm test` y `npm run build` pasan dentro del paquete, y el drift del proyecto sigue en 0.

## 10. Orden de ejecución

1. **Gobernanza.** Se registran FB-006, este PRD, ADR-007 (paquete aislado, estilos y fuentes) y SDD-011 (sistema visual, pantallas, datos, orquestación y tareas).
2. **Canvas.** Tres direcciones de la Planta (Planta de acero, Sala de control, Pliego de cianotipo). El usuario elige una, se lleva a alta fidelidad con las 7 vistas y se itera hasta que la aprueba. Si cambian tokens o pantallas, se actualiza SDD-011.
3. **Base.** Scaffold, tokens, datos mock, utilidades y componentes compartidos.
4. **Pantallas.** Las vistas de trabajo, acceso y ajustes, implementadas en paralelo por órdenes capilares.
5. **Revisión.** Code review, auditoría de accesibilidad, capturas a 1440 y 375 px y autocrítica, incluida la regla de sacar un elemento de más.
6. **Cierre.** Todas las órdenes en `done`, drift en 0 y cierre humano con `prdm close PRD-006 --ack`.

## 11. Criterio de éxito

PRD-006 se cierra cuando se cumplen todas estas condiciones:

- el usuario aprobó el canvas,
- todas las vistas corren en `design/centurion-factory` con datos mock y cumplen los criterios de 4.1 a 4.4 y la calidad no negociable,
- todas las órdenes de ADR-007 y SDD-011 están en `done` con commits trazados,
- `get_closure_readiness PRD-006` pasa sus cinco checks.
