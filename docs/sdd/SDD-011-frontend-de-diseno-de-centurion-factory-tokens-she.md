---
architects: ["PRD-006"]
impacts_paths: ["design/centurion-factory/src/**","design/centurion-factory/tests/**","design/centurion-factory/scripts/**","design/centurion-factory/canvas/**","design/centurion-factory/CLAUDE.m[d]"]
tags: ["design","frontend","mock","canvas","accessibility"]
id: "SDD-011"
type: "SDD"
title: "Frontend de diseño de Centurion Factory: tokens, shell, pantallas y datos mock"
created_at: "2026-09-15"
---

## Contexto

PRD-006 pide rediseñar el frontend de Centurion Factory solo con datos mock. El stack y la ubicación los fija ADR-007: `design/centurion-factory`, React 19.3.0, Vite 8.3.0, react-router 8.3.1, CSS Modules y tokens.

El diseño **se itera primero en un canvas de diseño con el usuario**, y el código implementa el canvas aprobado. Este SDD define:

- el sistema visual,
- el mapa de pantallas,
- la forma de los datos mock,
- la orquestación de trabajo y
- las tareas.

**Sobre `impacts_paths`:** se listan subdirectorios y manifiestos del paquete, no `design/centurion-factory/**`, para no gobernar `node_modules/`, `dist/` ni `screenshots/`. Los archivos únicos que todavía no existen usan patrón dinámico (`CLAUDE.m[d]`), como en SDD-006. Los manifiestos (`*.json`, `*.config.ts`, `index.html`) y `src/styles/**` también los gobierna ADR-007.

## Ancla de diseño

Centurion Factory es una fábrica de software, y el diseño toma el vocabulario de una planta:

- **La línea:** las seis estaciones del ciclo de vida de PRD-002 (Ingesta, Definición, Diseño, Planificación, Ejecución, Cierre), por las que avanza cada feature.
- **El andon:** la lámpara de parada de línea. Representa el drift, e indica dónde y por qué se frenó la línea.
- **Cianotipo:** el color de los blueprints (SDD y ADR, que literalmente lo son).
- **Trazabilidad de lote:** la cadena Feedback/Artifact → Feature → Blueprint → WO → Commit → CodeRef.

## Sistema visual (propuesta inicial; el canvas aprobado manda)

### Color

| Token | Hex | Rol |
|---|---|---|
| `--grafito` | `#17191C` | Texto principal y fondo del tablero de línea |
| `--acero` | `#E9ECEB` | Fondo de la app: gris acero frío, no crema |
| `--cianotipo` | `#1F4FA0` | Acciones primarias, enlaces, nodos blueprint |
| `--andon` | `#F5C400` | **Solo** drift o parada de línea; nunca como texto sobre fondo claro |
| `--senal` | `#1E7F4F` | OK, sincronizado, hecho |
| `--paro` | `#B8322A` | Error, bloqueante |

Neutros derivados: `--superficie #FBFCFB`, `--regla #C9CFCD`, `--apagado #565D63`. Todo par de texto se verifica contra WCAG AA (≥4.5:1, o ≥3:1 para texto grande) con un test.

### Tipografía

- **Archivo** (variable, eje `wdth`): ancha en titulares de estación y KPIs, condensada en tablas densas, normal en el cuerpo.
- **IBM Plex Mono:** solo para identificadores literales.
- **Escala:** 12, 14, 16, 20, 28 y 44 px.
- **Cifras:** tabulares en tablas y KPIs.

### Espacio y forma

- **Espaciado:** 4, 8, 12, 16, 24, 32 y 48 px.
- **Radio:** 2 px en placas y 4 px en inputs.
- **Bordes:** reglas de 1 px.
- **Elevación:** solo en modal, drawer y toast.

### Layout

La planta se lee de izquierda a derecha: las estaciones son columnas fijas y cada feature es una fila que avanza.

- **Estructura:** grilla de 12 columnas, con las estaciones alineadas con las columnas de las tablas de abajo y un sidebar de 224 px.
- **Mobile (375 px):** barra inferior con cinco destinos más "Más", y el tablero se apila en estaciones verticales.

### Hero y motion

- **Hero:** el tablero de línea en la Planta, una banda oscura a todo el ancho. Muestra marcadores por estación, una barra segmentada de WOs hechas sobre el total, y el andon encendido en la estación donde se frenó la línea. Es el único lugar audaz; todo lo demás queda callado.
- **Motion:** un único momento orquestado al cargar la Planta. Las estaciones se encienden de izquierda a derecha, los marcadores se deslizan y el andon se enciende último. Con `prefers-reduced-motion`, se muestra directamente el estado final.

### Crítica contra los tells de IA

| Tell | Decisión |
|---|---|
| Fondo crema y acento terracota | Evitado. También se descartó el instinto de consola oscura con glow cian (Stark HUD) por genérico. |
| Eyebrows en mayúsculas | Sacados; todo en sentence case |
| Cards redondeadas idénticas con la misma sombra | Jerarquía en tres niveles: banda a sangre, tablas planas con reglas, overlays elevados |
| Flechas en botones, monospace en labels, gradientes | Sacados; monospace solo para identificadores reales |
| Numeración 01/02/03 | Sacada; la secuencia la da la posición en la línea |
| Inter o Space Grotesk | Reemplazadas por Archivo |

## Canvas de diseño

El canvas es la fuente de verdad visual, y su working set vive en `design/centurion-factory/canvas/` (artboards `.dc.html` y `canvas.json`).

1. **Direcciones:** tres bocetos de la Planta, cada uno con motivación y tradeoff.
   - **A "Planta de acero"**: la propuesta de arriba.
   - **B "Sala de control"**: oscura y densa, evoluciona Stark HUD.
   - **C "Pliego de cianotipo"**: hoja técnica con grilla y rótulo de plano.

   Gate: el usuario elige una.
2. **Hi-fi:** las 7 vistas en desktop (1440×900); Planta, Documento y Órdenes en mobile (390×844); una página de componentes; y las interacciones clave clickeables.
3. **Iteración hasta que el usuario aprueba.** Si cambian tokens o pantallas, este SDD se actualiza antes de implementar.

## Pantallas

| Ruta | Vista | Contenido |
|---|---|---|
| `/` | Planta | Tablero de línea, KPIs de `get_metrics`, drift reciente, órdenes activas |
| `/arbol/:id?` | Árbol de features | Árbol navegable por teclado (`role="tree"`), panel de trazabilidad, modal "Cerrar feature" con los 5 checks de closure readiness |
| `/documentos` | Documentos | Tabla con búsqueda, filtros (tipo, estado de flujo) y orden; modal "Nuevo documento" |
| `/documentos/:id` | Documento | Editor Markdown, formulario de frontmatter, acciones de flujo, propuesta del agente con diff, comentarios, versiones y validación. "Guardar" muestra el toast "Guardado". |
| `/ordenes` | Órdenes de trabajo | Filtros (estado, blueprint, agente o dev), búsqueda, orden, drawer de detalle, modales "Tomar orden" y "Completar" |
| `/drift` | Drift | Reporte oficial, previews por rama, historial, issues por tipo y severidad, modal "Reconocer drift" |
| `/entrada` | Bandeja de entrada | Feedback y artifacts, triage `new → triaged`, enlace a feature |

## Datos mock

- **Tipos:** `src/data/types.ts` modela `@prdm/core` (dominio) y `@prdm/contracts` sin importarlos.
- **Contenido:** ids y títulos reales del grafo; los estados son de muestra, porque el grafo real está 100 % en verde.
- **Volúmenes:**

  | Entidad | Registros |
  |---|---|
  | Features | 12 |
  | Blueprints | 16 |
  | WOs | 40 |
  | Documentos | 20 |
  | Issues de drift | 14 |
  | FB y ART | 14 |
  | Commits | 24 |
  | Miembros | 8 |

- **Estados de demo:** `?estado=cargando|vacio|error` en cualquier vista, y un skeleton simulado en el primer render.
- **Copy:** voz activa y sentence case. Los errores dicen qué pasó y cómo resolverlo.

## Calidad

- Responsive hasta 375 px.
- Focus visible por teclado.
- Respeta `prefers-reduced-motion`.
- Contraste AA verificado por test.
- Cero hex fuera de `tokens.css`, también verificado por test.

## Orquestación

| Fase | Agentes | Skills | Gate |
|---|---|---|---|
| Canvas | Lead y un revisor en segundo plano | design, ui-ux-pro-max, dataviz | El usuario elige dirección y aprueba el canvas |
| Base | Lead y fullstack-developer | ui-ux-pro-max:design-system, ui-ux-pro-max:ui-styling | typecheck, tests y code review |
| Pantallas | Tres fullstack-developer en paralelo | ui-ux-pro-max, dataviz | typecheck separado de test, y code review |
| Pulido | Lead y revisores (a11y, crítica de diseño) | run, Playwright | Capturas revisadas, AA, 375 px, drift en 0 |

**Reglas de árbol compartido:**

- Nada de `git stash`.
- Todo commit con pathspec explícito y trailer `Refs:`.
- Solo el lead completa WOs, con el árbol quieto.

## Cómo se corre

Todo corre dentro de `design/centurion-factory`:

- `npm install`
- `npm run dev`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `node scripts/screenshots.mjs`

## Tareas

- [ ] Canvas de direcciones: tres bocetos de la Planta (Planta de acero, Sala de control, Pliego de cianotipo) con nota de tokens y crítica, guardado y compartido, hasta que el usuario elige dirección
- [ ] Canvas hi-fi de la dirección elegida: 7 vistas desktop, Planta, Documento y Órdenes en mobile, página de componentes e interacciones clave clickeables
- [ ] Rondas de iteración del canvas hasta aprobación del usuario y sincronización de tokens y mapa de pantallas aprobados en este SDD
- [ ] tokens.css con color, tipografía, espaciado, radios y motion, con test que parsea los tokens y verifica contraste AA de los pares de texto
- [ ] base.css con reset, focus-visible, prefers-reduced-motion y cifras tabulares, con test que falla si aparece un hex fuera de tokens.css
- [ ] Tipos del dominio mock en src/data/types.ts modelados sobre core/domain y contracts sin importarlos
- [ ] Mocks de features, blueprints y work orders con ids y títulos reales del grafo y tests de invariantes (volúmenes, estados cubiertos, enlaces válidos)
- [ ] Mocks de documentos, versiones, hilos de comentarios, propuestas del agente e issues de validación, con tests
- [ ] Mocks de reportes e issues de drift, commits, code refs, métricas, feedback, artifacts y miembros, con tests
- [ ] lib/filter-sort con búsqueda, filtros combinados y orden estable, escrito test-first
- [ ] lib/use-demo-state con ?estado=cargando|vacio|error y latencia simulada, escrito test-first
- [ ] Router con createBrowserRouter y AppShell con sidebar desktop, barra inferior mobile, skip link y título por ruta, con tests
- [ ] Componentes StatusBadge, IdTag, Skeleton, EmptyState y ErrorState, con tests
- [ ] DataTable con encabezados ordenables y aria-sort, filas apiladas bajo 640px, FilterBar y SearchField, con tests
- [ ] Modal sobre dialog nativo con Esc y retorno de foco, y Drawer, con tests
- [ ] ToastProvider con región aria-live, con tests
- [ ] LineBoard con estaciones, marcadores, barra segmentada de WOs, andon y disposición vertical en mobile, con tests
- [ ] Momento orquestado de carga de la Planta respetando prefers-reduced-motion
- [ ] Planta con KPIs de métricas, drift reciente y órdenes activas
- [ ] Árbol de features navegable por teclado (flechas, Home, End, expandir y colapsar), con tests
- [ ] Panel de trazabilidad del nodo seleccionado desde feedback hasta code refs
- [ ] Modal Cerrar feature con los cinco checks de closure readiness
- [ ] Lista de documentos con búsqueda, filtros, orden y modal Nuevo documento con toast
- [ ] Documento: layout, formulario de frontmatter, editor Markdown y Guardar con toast Guardado, con tests
- [ ] Documento: acciones de flujo draft, in_review, published y archived según rol
- [ ] Documento: propuesta del agente con diff, aceptar y rechazar, y atribución Agente (aceptado por …)
- [ ] Documento: hilos de comentarios, versiones con restaurar y panel de validación
- [ ] Órdenes de trabajo: tabla con filtros, búsqueda, orden y estados vacío, error y cargando
- [ ] Órdenes de trabajo: drawer de detalle y modales Tomar orden y Completar
- [ ] Drift: reporte oficial, previews por rama e historial
- [ ] Drift: issues por tipo y severidad, modal Reconocer drift y estado de error de reporte de CI
- [ ] Bandeja de entrada: feedback y artifacts con triage y enlace a feature
- [ ] Script de Playwright que captura todas las rutas a 1440 y 375
- [ ] CLAUDE.md del paquete con tokens, escala de espaciado, convención de componentes, regla de nunca hardcodear hex, comandos y estados de demo
- [ ] Correcciones de accesibilidad y responsive surgidas de la revisión (foco, contraste AA, 375px, teclado)
- [ ] Pulido desde la autocrítica de capturas, incluida la regla de Chanel de sacar un elemento
