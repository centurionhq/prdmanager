# Drift · Reconocer con granularidad y conteo: decisiones de diseño

Placa: `Drift-Reconocer.dc.html` (nueva; un artboard de 1440 × 2508 con cuatro placas: **A** el modal y **B** la lista, cada una en desktop 1440 y mobile 375). `Drift.dc.html` no se tocó: `Ordenes-Archivar.dc.html` la cita como la placa vigente del modal.

> **Cómo se verificó.** Pantalla real vista con el MCP de Chrome a 1440 y 375 (`/o/centurionhq/p/prdmanager/drift`). El comp lo rendericé en Chromium vía `file://` (el `support.js` del runtime no está en `canvas/`): 1440 de ancho sin scroll horizontal, y todos los controles de mobile miden 44 px.

## 1. Qué se veía feo (evidencia)

- **El modal no dice el alcance.** El select «Qué reconocer» es un `<select>` nativo cuyas opciones son solo el id (`SDD-008`, `SDD-009`…) más «Todo el proyecto». No hay conteo ni título. El texto de abajo es el mismo para cualquier opción, así que elegir `SDD-006` (7 issues) o «Todo el proyecto» (125) se confirma con la misma frase y el mismo botón «Reconocer drift». El usuario no sabe qué está cerrando.
- **No hay manera de reconocer desde la lista.** Hay filas con el mensaje y «Qué hacer: … reconocé el drift», pero ninguna acción por fila ni por subgrupo. El subgrupo (`SDD-006  7`) tiene el conteo pero es un encabezado inerte: hay que subir al botón de la cabecera, abrir el modal y buscar el documento en un select de ~41 opciones.
- **El conteo del subgrupo no se conecta con nada.** Está como «7» pelado, sin unidad.
- **Mobile (375): el CTA queda cortado.** `scrollWidth` de la página = 537 px con viewport de 375: hay scroll horizontal, y la fila de acciones de la cabecera (`Actualizar reporte`, `Autorizar force-push`, `Reconocer drift`) corta el botón primario (se ve «R»). Fuera del alcance de esta placa, pero afecta al punto de entrada del modal: queda anotado abajo.
- **Targets chicos.** En 375 hay muchos botones y enlaces por debajo de 44 px (202 elementos `button`/`a` medidos con alto < 44), en particular los filtros y los controles de fila.
- **Copy con jerga.** «reconocé el drift» y «línea base» sin decir de qué documento ni cuántos issues.

## 2. Decisiones de diseño

- **El baseline avanza por documento; el diseño lo dice con números.** Cada opción del select lleva `id · título` y, a la derecha, `N issues` en cifras tabulares. Las opciones se ordenan por conteo descendente (lo que más pesa, primero); «Todo el proyecto · 125 issues» queda separado y último. Un pie «Y 37 documentos más…» evita que parezca una lista completa.
- **Resumen de tres filas entre el select y el texto** (Documento · Issues que cubre · Avanza al commit): es lo que el usuario necesita para decidir, en forma de tabla plana con reglas (sin tarjeta), con las etiquetas en `--apagado` y los valores en 600.
- **El texto explica lo que el número no puede**: «La línea base avanza por documento, no por issue: se reconocen los 7 juntos…». Se conserva la frase de las órdenes abiertas y la línea de auditoría, ahora con el nombre.
- **El botón confirma el alcance**: «Reconocer 7 issues» / «Reconocer 1 issue» / «Reconocer 125 issues». El conteo cambia con la opción, igual que en `Ordenes-Lote.dc.html` («orden» → «órdenes»).
- **«Todo el proyecto» se distingue**: aviso con barra `--andon` (drift, uso permitido), texto en `--andon-texto`, y la salida («reconocelos de a uno»). El botón sigue siendo primario: no es destructivo, queda auditado.
- **La misma acción en tres niveles**, siempre sobre el documento: encabezado de subgrupo («Reconocer los 9 issues», secundario), fila («Reconocer | 9», secundario, con el conteo separado por una regla) y la cabecera de la pantalla. Fila y encabezado abren el modal con ese documento preelegido. La fila **nunca** sugiere que reconoce un solo issue: lleva el conteo del documento y `aria-label="Reconocer SDD-012: cubre 9 issues"`. Una sola línea bajo el título del grupo lo explica una vez, en vez de repetirlo en cada fila.
- **Se saca el id azul de cada fila** (redundante con el encabezado del subgrupo): el ojo escanea mensaje y acción.
- **Estados**: foco visible (`--focus-ring`: lo muestran el select abierto y el primer botón de fila), «Reconociendo…» deshabilitado en el subgrupo en curso (no se puede doble-enviar), singular en un solo issue, toast de confirmación con conteo («4 issues salieron de la lista»).
- **Mobile 375**: pie del modal apilado (principal arriba, ancho completo, 44 px), select de 44 px, cierre de 44 px, encabezado de subgrupo en dos líneas con la acción a ancho completo, botón de fila de 44 px bajo el mensaje. Sin scroll horizontal; el contenido respeta la barra inferior de 64 px.
- **Tipografía y espaciado**: solo tokens (`--text-xs…xl`, `--space-*`, `--regla`, `--regla-fila`, `--superficie`, `--relleno`, `--seleccion`). Mono solo para ids, SHAs y rutas. Sentence case, sin flechas en botones.
- **Contraste**: texto secundario en `--apagado` (#565D63) sobre acero/superficie ≥ 5:1; ningún amarillo como texto sobre claro.

## 3. Qué cambia respecto de hoy

| Hoy | Ahora |
|---|---|
| Opciones del select: solo `SDD-006` | `SDD-006 · título` + `7 issues`, ordenadas por conteo |
| Una frase para cualquier opción | Resumen (documento, issues, commit) + «por documento, no por issue» |
| Botón «Reconocer drift» siempre igual | «Reconocer 7 issues» (cambia con la opción) |
| Subgrupo `SDD-006  7` inerte | `SDD-006 · título · 7 issues` + «Reconocer los 7 issues» |
| Fila sin acción | «Reconocer \| 7» por fila, abre el modal preelegido |
| Sin estado en curso ni confirmación | «Reconociendo…» y toast con el conteo |
| «Todo el proyecto» como una opción más | Alcance explícito con aviso y conteo de documentos |

## 4. Quién decide qué

**Producto (prdm-pm)**
- Que el conteo de cada opción sea «issues del documento en el reporte actual»: ¿incluye avisos que no son reconocibles (ciclo de vida, `impacts_paths`)? El comp dibuja «7 errores de código» como si todos lo fueran; si reconocer no cubre algunos tipos, el conteo y el texto deben decir «N de M».
- Que reconocer desde una fila cubra todo el documento (no un issue suelto): es la regla del motor; el comp la hace explícita, no la cambia.
- «Todo el proyecto»: ¿pide confirmación extra (por ejemplo, tipear el nombre) o alcanza con el aviso?
- Texto exacto del toast y si hay «Deshacer» (hoy no existe; el historial de drift es el registro).

**Front (prdm-frontend)**
- `acknowledgeableTargets` (`routes/drift/drift-groups.ts`) hoy devuelve `{ value, label }` con solo el id: necesita `count` y `title`. El título del documento hay que traerlo del grafo; si no está en el DTO de issues, es un cambio de contrato (consultar con backend).
- El `<select>` nativo no puede mostrar la columna de conteo alineada: usar un listbox propio (`role=listbox`, 44 px por opción, teclado completo) o, mínimo, el conteo dentro del texto de la opción («SDD-006 · 7 issues») con el resumen debajo.
- `AcknowledgeModal` acepta un `initialTarget` y se abre desde fila y subgrupo; botón principal con el conteo; pie apilado bajo 768 px.
- `DriftIssuesList`: botón por fila y por subgrupo, `aria-label` con el documento y el conteo, estado «Reconociendo…» y el toast.
- Aparte, en mobile: la fila de acciones de la cabecera de Drift desborda (537 px de ancho en 375). Hay que apilarla o mover «Actualizar reporte» y «Autorizar force-push» a un menú; no está dibujado acá.

## 5. Rulings de producto (prdm-pm, 2026-11-22) — el comp se implementa con estas reglas

Estas decisiones cierran las preguntas abiertas de §4. Manda este apartado sobre el dibujo cuando haya diferencia; el canvas final (WO-768) se actualiza a esto.

- **A1 · Qué cuenta el número.** El conteo de cada opción es **la deuda que ese documento carga hoy en el reporte** (todos sus issues, todas las severidades y tipos), y se desglosa:
  «SDD-013 · 15 issues» + una línea «12 de código se resuelven al reconocer · 3 de ciclo de vida e impacts_paths no».
  Fundamento: reconocer mueve `baseline.docs[id]`/`governs[bp]` (`core/src/sync/monitor.ts:345-356`) y eso resuelve `code_out_of_sync` (`monitor.ts:215-225`) y `work_order_out_of_sync`, pero **no** `lifecycle_violation` (`checkLifecycle`, depende del grafo), `impacts_warning` por patrón declarado (`monitor.ts:216-219`) ni `landed_but_open` (`landedButOpenIssues`, depende del estado del WO). Contar todo y dejar creer que todo se resuelve sería la mentira más caras de esta pantalla; contar solo lo resoluble esconde deuda que el usuario vino a mirar. Se dicen los dos números.
- **A2 · Sin títulos en la opción.** El `DriftIssueDto` no trae el título del documento y sumar contrato por cosmética no se justifica: la opción es `«SDD-013 · 15 issues»`, sin `· título`. El título se ve en el documento, no en el select.
- **A3 · Sin reordenar por cantidad.** Se mantiene el orden de hoy (blueprints con issues primero, «Todo el proyecto» último). El select elige un target; priorizar es trabajo de la lista (PRD-041), no de este control.
- **A4 · «Todo el proyecto» pide un gesto más.** Nada de tipear el nombre: un checkbox obligatorio «Entiendo que avanza la línea base de todo el proyecto (N documentos)» habilita el botón de confirmar sólo cuando el target es `all`. En los targets de documento no hay checkbox: el conteo desglosado + la explicación alcanzan, y no se le pone fricción al caso frecuente.
- **A5 · Toast sin «Deshacer», con el número del server.** «Reconociste SDD-013: 15 issues. Quedan 190 en el proyecto.» El «quedan» sale de `report.issues.length` de la respuesta (`api/graph.ts:77`). No hay undo que ofrecer: el registro es el historial de drift, como ya dice el modal.
- **A6 · Fuera de alcance, con fricción registrada.** El desborde del encabezado en 375 px y sacar el id de cada fila (se usa para navegar) no entran en este WO; el desborde se registra como FB aparte.

**Números del canvas:** los del dibujo son ilustrativos. El canvas final (WO-768) usa los conteos del reporte oficial vigente al momento de implementar, contados del DTO — nunca hardcodeados.
