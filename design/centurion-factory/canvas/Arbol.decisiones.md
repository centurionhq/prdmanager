# Árbol: decisiones de diseño

Comp: `Arbol.dc.html` (actualizado, no nuevo). Props del canvas: `vista` (escritorio 1440 / móvil 375), `estado` (con_datos / cargando / sin_datos), `filtro` («Sin código» no / sí), `busqueda` (la que ya existía) y `cierre` (el modal de «Cerrar feature» que antes se dibujaba siempre encima; ahora es opt-in, por defecto apagado, para que no tape el comp).

> **Limitaciones de esta pasada.** (1) `support.js` (el runtime del canvas) no está en el repo, así que **no pude abrir el comp renderizado**: balanceé etiquetas (`sc-if`, `sc-for`, `div`) por script y copié la sintaxis de `AgentePanel`/`Ordenes`, pero falta verlo en el runtime antes de aprobar. Los `sc-for` anidados (partes del título dentro de cada orden) son lo más probable que requiera ajuste. (2) `canvas.json` ya registra `Arbol.dc.html`; no lo toqué. (3) Los datos del comp son mock con forma real (títulos y órdenes vistos en vivo); los SHA y varios títulos de orden son inventados.

## 1. Qué se veía feo y por qué (evidencia en vivo, centurion.ngrok.app)

- **Carga muda.** Al entrar, `/arbol` muestra solo ocho barras grises sin etiqueta y un `role="status"` vacío (`<span role="status"></span>` en la fila del chip). Nadie sabe qué está cargando.
- **Dos conteos y un chip huérfano.** El chip «Sin código (9)» queda solo en una fila, con un `role="status"` vacío al lado, y debajo otra fila con «68 features, 8 cerradas». El conteo vive en dos lugares.
- **Títulos del árbol ilegibles.** Con sangría de 20 px por nivel (hasta el nivel 8 = 140 px), los títulos de 90+ caracteres quedan en «Trazabilidad inversa: la lista de feat…» o peor. El id mono compite con el título.
- **Panel: Markdown crudo.** Los títulos de orden se ven como `**WO-B (app: Planta + canvas, depende de WO-A)** — D5 en \`packages/app/src/routes/Planta.tsx:263-300\` ... \`Pl`: asteriscos, acentos graves, y el texto se corta a mitad de palabra. Cada fila de orden ocupa ~150 px y llega a 7 líneas.
- **Tabla desbalanceada.** Orden · Título · Estado · Commit: la celda Commit solo muestra «—» y no dice si el commit existe, está en main o falta. Sin tope de filas ni total visible.
- **Trazabilidad apretada.** En 6 columnas de ~110 px, «FB-179, FB-151, BC-022» se parte en dos líneas y el bloque «Commits» cae a una segunda fila suelta.
- **Foco y selección confundidos.** La fila seleccionada se marca con el mismo anillo azul de 2 px que el foco de teclado: no se distingue «elegida» de «con foco».
- **Estado solo por color.** El punto de drift es un círculo amarillo con `title` (no se anuncia ni se ve en táctil).
- **375 px empeora.** `scrollWidth` = 631 px: hay scroll horizontal. El panel queda apretado en una columna angosta a la derecha (títulos de una palabra por línea). Targets bajo 44 px: búsqueda 26 px de alto visible, «Ver las 8 órdenes» 15 px, «Saltar al contenido» 40 px. El árbol completo (68 filas) empuja el panel muy abajo.

## 2. Decisiones de diseño

**Jerarquía.** Página (h1 44 px) → dos columnas separadas por una regla: árbol (380 px) y panel. En el panel: cabecera de feature (id + estado + h2 28 px) → Trazabilidad → Órdenes recientes. Un solo botón primario-secundario por zona («Cerrar feature»).

**Árbol.** Sangría de 12 px por nivel con **tope de 4 niveles** (48 px); el nivel real queda en `aria-level`. Título en texto plano a **2 líneas** (el id mono va en línea, antes del título, en `--apagado`), con el texto completo en `title`. Altura mínima de fila 40 px (44 px en móvil). Seleccionada = fondo `--superficie` + regla + barra interior de 3 px `--cianotipo`; el foco de teclado sigue siendo `--focus-ring`, así que ya no se confunden. Cerradas atenuadas en `--apagado`. El drift lleva punto andon + texto para lectores de pantalla (el punto no es el único portador).

**Encabezado y filtro (d, e).** Fila 1: búsqueda. Fila 2: chip «Sin código (6)» como toggle (`aria-pressed`); activo = relleno `--grafito` + texto blanco + tilde, así que **no depende del color**. Junto al chip solo aparece «Quitar filtro». Fila 3 = **el único conteo**: sin filtro «68 features, 8 cerradas»; con filtro o búsqueda «6 resultados de 68 features» (`role="status"`, anuncio educado). «Contraer todo» se oculta cuando hay filtro (no hay árbol que contraer).

**Panel (a, b, c, g).** Tabla Orden (72) · Título (flexible) · SDD (80) · Estado (104) · Commit (144), sin Fecha. El **título** es texto plano a 2 líneas; el código en línea es una pieza mono (`IBM Plex Mono` 12 px sobre `--relleno`) y el título completo va en `title`. SDD es enlace mono `--cianotipo`. **Commit**: marca no cromática (círculo con tilde si aterrizó; círculo punteado si no) + sha corto mono + «aterrizado en main» debajo; sin commit: «Sin commit» en `--apagado`. Debajo de la tabla: «Mostrando las 25 órdenes más recientes de 37» y el enlace «Ver las 37 órdenes en la cola». En el comp se dibujan 6 filas; las 25 son el mismo patrón.

**Trazabilidad.** Rejilla 3×2 con reglas finas en vez de 6 columnas con riel: los ids ya no se parten. «Commits» pasa a «N aterrizados en main» (mismo vocabulario que la tabla). Se agrega «Drift».

**Estados.** *Cargando*: cada región (árbol y panel) es su propio `role="status"` con texto visible: «Cargando el árbol de features…» y «Cargando las órdenes y la trazabilidad de FR-009…», más barras que imitan la forma real (sin shimmer, respeta `prefers-reduced-motion`). *Con datos*, *filtro activo*, *búsqueda sin resultados* (EmptyState existente) y *feature sin trazabilidad* (existente) se conservan.

**Espaciado y tipografía.** Solo escala 4/8/12/16/24/32. Cuerpo 14 px; celdas de tabla 12 px de padding vertical; Archivo en todo salvo ids/código/sha (IBM Plex Mono, regla de «mono solo para literales»).

**A11y.** Foco visible con `--focus-ring` en todo control (el chip activo lo muestra dibujado), contraste AA con pares ya probados (`--grafito`/`--superficie`, `--apagado`/`--superficie`, `--senal-texto`, `--andon-texto`, blanco sobre `--grafito`), targets de 44 px en móvil (control-height), `role="tree"`/`treeitem`/`table` con nombre.

**375 px (h).** Sin rediseño de dos pantallas: árbol arriba, panel debajo, **en columna única** y sin scroll horizontal (`min-width: 0`, `overflow-wrap: anywhere`, la tabla se apila: una orden por bloque con id + estado / título / SDD + commit). Barra inferior de 64 px igual. El árbol sigue con su largo natural (anotación punteada en el comp); no se empeora nada: se corrige el ancho de 631 px.

## 3. Qué cambia respecto de hoy

| Hoy | Propuesto |
|---|---|
| Carga: barras grises sin texto | Cada región dice qué carga, con `role="status"` |
| Chip suelto + otra fila de conteo | Chip toggle con conteo en la etiqueta; un único conteo en el encabezado; solo «Quitar filtro» al lado |
| Sangría de 20 px/nivel, título a 1 línea cortada | 12 px/nivel con tope, título a 2 líneas, `title` completo |
| Títulos con `**`, acentos graves y cortes | Texto plano + código mono en línea, 2 líneas |
| Orden · Título · Estado · Commit («—») | Orden · Título · SDD · Estado · Commit (marca + sha + «aterrizado en main» / «Sin commit»); sin Fecha |
| Sin tope ni total | 25 más recientes + total + enlace a la cola |
| Trazabilidad 6 columnas | 3×2, con «Commits aterrizados» y «Drift» |
| Selección = anillo de foco | Selección = barra + fondo; foco aparte |
| 375 px: 631 px de ancho, panel angosto | 375 px: columna única, 0 scroll horizontal, tabla apilada, targets 44 px |

## 4. Quién decide qué

**Producto (prdm-pm).**
- Definición de «aterrizado» (commit alcanzable desde main con `Refs: WO-xxx`) y el copy «aterrizado en main» / «Sin commit».
- Tope de 25 y retirar la columna Fecha del panel.
- **Preguntas abiertas que el comp resuelve provisoriamente:** (1) con el filtro «Sin código» el comp muestra solo las coincidencias, planas; falta decidir si deben verse sus ancestros. (2) «Contraer todo» se oculta con filtro. (3) «Commits: N aterrizados en main» y «Drift: N avisos abiertos» en Trazabilidad son copy nuevo; confirmar que son datos disponibles. (4) Estado «En curso» de las órdenes usa `--cianotipo`; confirmar el mapa de estados de WO.

**Front (prdm-frontend).**
- Sangría de 12 px con tope de 4 niveles (`--depth` en `FeatureTree.module.css`) y título a 2 líneas con `title`.
- Render de títulos: texto plano con segmentos de código en `.cod`; sin interpretar Markdown (tratarlo como literal y detectar los tramos entre acentos graves).
- Chip como `aria-pressed`, conteo único en `role="status"`, quitar el `role="status"` vacío.
- Estados de carga con etiqueta visible; marca de commit (círculo con tilde / punteado) y celda de dos líneas.
- Tabla apilada < 640 px, `min-width: 0`/`overflow-wrap` para eliminar los 631 px, targets de 44 px en búsqueda y enlaces del panel.
- Selección separada del foco (barra interior vs `--focus-ring`).
- Nada de esto agrega tokens: todo sale de `tokens.css`.
