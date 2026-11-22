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

**Encabezado y filtro (d, e).** Fila 1: búsqueda. Fila 2: chip «Sin código (1)» como toggle (`aria-pressed`); activo = relleno `--grafito` + texto blanco + tilde, así que **no depende del color**. Junto al chip solo aparece «Quitar filtro». Fila 3 = **el único conteo**: sin filtro «68 features, 8 cerradas»; con filtro o búsqueda «1 resultado de 68 features» (`role="status"`, anuncio educado). «Contraer todo» se oculta cuando hay filtro (no hay árbol que contraer). WO-742 (SDD-102): el chip cuenta sólo las huérfanas del Feature Tree, así que las BC huérfanas ya no entran y queda una sola fila, `PRD-012`.

**Panel (a, b, c, g).** Tabla Orden (72) · Título (flexible) · SDD (80) · Estado (104) · Commit (144), sin columna Fecha. El **título** es texto plano a 2 líneas; el código en línea es una pieza mono (`IBM Plex Mono` 12 px sobre `--relleno`) y el título completo va en `title`. SDD es enlace mono `--cianotipo`. **Commit** (actualizado por §8, SDD-120 D4/D5): marca no cromática (círculo con tilde si aterrizó; círculo punteado si no) + sha corto (7) del commit canónico + «· N commits» cuando hay más de uno + «aterrizado en main» y la fecha debajo; sin commit: «Sin commit» en `--apagado`. Sobre la tabla: «N de M órdenes pendientes ya tienen commit»; debajo: «Mostrando las 25 órdenes más recientes de 37», el enlace «Ver las 37 órdenes en la cola» y la leyenda de la marca, con sus dos frases (§8). En el comp se dibujan 6 filas; las 25 son el mismo patrón.

**Trazabilidad.** Rejilla 3×2 con reglas finas en vez de 6 columnas con riel: los ids ya no se parten. «Commits» pasa a «N con `Refs:` a este documento» (§8, SDD-120 D6: el contador mide commits cuyos `refs` nombran estos blueprints, no aterrizajes), en las dos vistas, y sin celda «Drift» (decisión C4 de prdm-pm: la columna que el comp dibujaba se retiró del artboard).

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

## 5. WO-769 (SDD-112 C6/C7): «Código gobernado» acotado, con filtro local

El bloque no existía en el comp, y en la app montaba una fila por referencia (11.389 en BC-002: el 99 % de los 523.972 px de scroll del panel). Ahora el comp y la app dicen lo mismo:

- La tabla monta **25 filas** como máximo, ordenadas por `updatedAt` descendente y, a igualdad, por ruta ascendente (`CODE_LIMIT = 25`).
- Debajo va la línea gemela de la de órdenes: «Mostrando las **25** referencias más recientes de **N**», con los dos números en `.num`. Con N <= 25 la línea no se dibuja.
- Campo «Filtrar por ruta o símbolo» con **label visible** (40 px de alto en escritorio, 44 px en móvil) y «Limpiar» cuando hay texto: acota en memoria el conjunto ya cargado y la línea pasa a «Mostrando **25** de **M** coincidencias de **N** referencias». El filtro **no va a la URL**: es una herramienta de lectura local, no un filtro de pantalla como `?q=`/`?sinCodigo=1`.
- Aplica igual a una feature (conjunto de su branch) y a un blueprint (sus propias referencias). No hay «ver todas»: no existe pantalla de código del proyecto a la que enlazar y un expandible reintroduce las N filas que el criterio (a) prohíbe.
- A 375 px el filtro va a lo ancho y la tabla se apila (ruta mono arriba, símbolo debajo), sin scroll horizontal.

## 6. WO-770 (SDD-112 T6): el maestro del árbol sin marcas crudas y con el título completo al enfocar

El gate WO-752 midió, en navegador real, que el maestro seguía pintando el título crudo (FR-024 «…estado terminal `closed`…», FR-053 «…`get_node` devuelve `close_reason`…») y que el texto completo viajaba solo en el `title` nativo: al pasar el mouse sí, al enfocar con teclado no.

- **Comp:** las filas del árbol pintan el título con tramos: lo que está entre acentos graves va en `.cod` (IBM Plex Mono 12 px sobre `--relleno`), igual que la columna «Título» de órdenes. Se agregó la fila `FR-024` con `` `closed` `` para que el comp muestre el caso, en escritorio y en móvil. El `title` de la fila sigue siendo el texto plano completo (sin marcas). La fila no cambia de alto: el corte a dos líneas sigue en `.dos-lineas`.
- **App:** `FeatureTree.tsx` monta `MarkdownInline` (el mismo componente del panel) dentro de la fila y conserva `title={toPlainTitle(...)}`. El treeitem suma `aria-describedby` a un `<span class="visually-hidden">` con el título plano completo, así el texto completo se anuncia al enfocar con teclado. El texto visible va `aria-hidden`: el nombre accesible lo aporta el texto oculto, una sola vez (D6 del SDD-105 sigue en pie).
- **Sin `Tooltip`:** el trigger del design system tiene `tabIndex={0}` propio, o sea un segundo stop de tab dentro de cada treeitem. El criterio (e) del gate mide un solo enfocable por fila, y ArrowUp/ArrowDown/Enter no cambian.

## 7. WO-747 (SDD-104): la cadena SDD-rama en el panel — columna «SDD» y marca de commit

El comp ya traía la columna `SDD`, la marca de commit y «aterrizado en main»; este WO alinea el artboard con las decisiones C1-C5 de prdm-pm y con lo que la app puede leer del subgrafo del branch.

- **Comp:** se agregó el resumen «**3** de **5** órdenes pendientes ya tienen commit» sobre la tabla (escritorio y 375 px), la leyenda de la marca bajo la tabla («aterrizado en main» / «sin commit» / «La marca no cierra ni cambia el estado de la orden»), y en móvil «Commits» pasó a «3 aterrizados en main» (decía «3 en main»). Se retiró del relato la celda «Drift» que el artboard nunca dibujó (C4).
- **App:** `orderChainRows(subgraph)` (`packages/app/src/routes/arbol/order-chain.ts`) mapea el subgrafo que la pantalla ya consulta: `IMPLEMENTS` (WO→blueprint) da el SDD y `RESOLVES` (commit→WO) da el sha. Cero requests nuevos y `queryWorkOrders` intacto.
- **El enlace del SDD:** el SDD/FR lo nombra `/documento/<SDD>` (la ruta del paquete de diseño); en la app la ruta real es `documents/:docId` (`router.tsx`), así que la fila enlaza a `/o/<org>/p/<proyecto>/documents/<SDD>`. Lo que manda es que el id sea navegable, no el literal del path.
- **El sha es corto porque el grafo sólo guarda el corto:** `MERGE_COMMITS` indexa el Commit como `commit:<7 primeros del sha>` y la proyección del branch no publica `date`. Por eso la celda usa `ShaRef` en su modo copy-only (no hay repositorio en la fila) y **no** muestra fecha: es la decisión C1 (sin columna Fecha). `landedAt` existe en el helper, pero queda `null` hasta que la proyección publique el dato. **Superado por SDD-120** (§8): la proyección publica `sha` de 40 hex y `date`, la celda muestra la fecha y la copia lleva los 40 hex; sigue sin columna «Fecha».
- **Varios commits por orden:** gana el sha más alto, el desempate `ORDER BY c.date DESC, c.sha DESC` de `LIST_WORK_ORDERS`, que sin fecha es lo único determinista. **Corregido por SDD-120 D2** (§8): gana `date DESC, sha DESC` con nulos al final — el sha más alto era el desempate, no la regla, y divergía de `landedCommitSha` en 92 de 182 órdenes multi-commit.
- **Copy de los conteos:** «N aterrizados en main» se flexiona en singular («1 aterrizado en main»), igual que el resto de los conteos del panel. **Cambiado por SDD-120 D6** (§8): ese contador no mide aterrizajes.

## 8. WO-789 (SDD-120): el sha canónico, su fecha, los 40 hex y las dos copias contradictorias

El gate WO-748 midió que la fila mostrada (`d6f4139`, el sha más alto) no era la que publica el MCP (`landedCommitSha 8dd1c5c3…`, el más reciente). SDD-120 enmienda SDD-104: amplía la proyección del subgrafo y alinea el panel con el desempate del CLI. Este WO toca el comp y la app en el mismo commit.

- **Comp — celda Commit (escritorio y 375 px):** el sha corto es de 7 caracteres y es el del commit **canónico**; cuando la orden tiene varios, al lado va «· N commits» en texto secundario y el `title` del sha dice «el más reciente de N commits que resuelven esta orden». Debajo de «aterrizado en main» va la **fecha** del canónico (`21/11/2026, 14:11`, dd/mm/aaaa y 24 h, UTC). La orden con un solo commit no dice «· 1 commit»: no hay nada que desambiguar. El comp dibuja `WO-741` con 2 commits y fecha, `WO-740`/`WO-739` con 1 y fecha, y dos filas sin commit.
- **Comp — leyenda:** vuelve la frase que faltaba, «Las órdenes sin commit todavía no tienen un commit con el trailer `Refs: WO-xxx`», junto a la que ya estaba («La marca no cierra ni cambia el estado de la orden»). Sin la primera, «sin commit» se lee como un fallo de la pantalla y no como un hecho del grafo.
- **Comp — Trazabilidad:** el contador de Commits deja de decir «3 aterrizados en main» y pasa a «0 con Refs: a este documento». Cero es el valor honesto: en el grafo real los trailers son `Refs: WO-xxx`, así que el contador casi siempre marca 0 aunque la tabla tenga filas aterrizadas; decir lo que mide elimina la contradicción de la misma pantalla (D6).
- **App:** `orderChainRows` elige con `date DESC, sha DESC` y nulos al final (la regla de `LIST_WORK_ORDERS`), devuelve el sha de 40 hex de la proyección —con el `<7>` del ref como fallback si el server viejo no lo manda—, la fecha y `commitCount`. `ShaRef` suma dos props opcionales (`shortLength`, `note`): el panel pide 7 caracteres y la nota viaja en el `title` y en el nombre accesible del botón de copiar, que copia los 40 hex.
- **A11y:** la celda es una sola lectura («8dd1c5c Copiar · 2 commits aterrizado en main 21/11/2026, 14:11»); el botón de copiar se llama con el sha completo y la nota, así que un lector de pantalla sabe qué commit copia. Nada nuevo de contraste: el conteo usa `--texto-secundario` y la fecha `--apagado`, pares ya testeados en `tokens.test.ts`.


