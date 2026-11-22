# Órdenes: selección, barra de lote y los dos vacíos (SDD-086 §D6/§D7, FB-147/148)

Placas: `Ordenes.dc.html` (1440 x 1016 — 56 px de controles de maqueta + la pantalla de 960),
`Ordenes-Lote.dc.html` (1440 x 960), `OrdenesMobile.dc.html` (390 x 844) y
`OrdenesMobileVacio.dc.html` (390 x 844).

El código que estas placas gobiernan ya existe en `packages/app` (WO-688, commit `1857a77`, PR #82):
`packages/app/src/routes/Ordenes.tsx`, `ordenes/Ordenes.module.css` y `ordenes/BatchOrderModal.*`.
La placa no inventa producto nuevo: pone al día el canvas y decide lo que el implementado dejó abierto.

## 1. Qué estaba desactualizado

- `Ordenes.dc.html` no tenía **ninguna** señal de la selección múltiple: la tabla se dibujaba sin
  checkbox y sin barra de lote, así que los dos pedazos de FB-147 se construyeron directo con el design
  system y ningún mock los gobernaba.
- El único vacío dibujado era el de filtros (`Quitar filtros`), con un cuerpo que el implementado no
  tiene («No tenés órdenes tomadas en este proyecto. Quitá los filtros para ver las 40 órdenes.») — y ese
  40 era un número fijo, falso para cualquier filtro que no fuera «Tomadas por mí».
- No había placa de las confirmaciones del lote. `Ordenes-Archivar.dc.html` y `Ordenes-Tomar.dc.html`
  dibujan el archivado y la toma **de una orden**; el lote tiene otro alcance y otro copy.
- A 390 px no había ni selección ni vacío con salida.

## 2. Decisiones

- **P1 · El umbral de la barra es 2, y se ve.** Con una sola fila seleccionada el drawer ya ofrece la
  acción por orden; a partir de 2 hay ahorro real. El canvas lo hace evidente: el control de maqueta
  arranca con 3 seleccionadas, y destildar hasta dejar 1 hace desaparecer la barra.
- **P2 · La barra es una placa, no una banda flotante.** Misma superficie, borde y radio que la barra de
  filtros (`#FBFCFB` / `#C9CFCD` / 2 px); el contador va primero, empujando las acciones al extremo con
  `margin-right: auto`. `Archivar seleccionadas` y `Tomar seleccionadas` en secundario (son acciones
  destructivas o de reparto sobre N cosas, no la acción primaria de la pantalla); `Limpiar selección` en
  fantasma, porque salir de una selección no es una acción más.
- **P3 · Los dos vacíos se distinguen por lo que queda en pantalla, no por el copy.** Sin órdenes
  desaparece la barra de filtros (no hay nada que filtrar) y la salida es «Ir a Construir»; sin resultados
  los filtros siguen arriba y la salida es «Quitar filtros». Se comparan en una sola placa con el control
  de maqueta («Con órdenes» / «Proyecto sin órdenes»), y el vacío por filtros se llega además por el chip
  «Tomadas por mí» (0).
- **P4 · El copy del vacío sin órdenes es el del implementado.** «Las órdenes no se crean a mano: se
  generan del checklist `## Tareas` de un blueprint publicado (un SDD o un ADR).» La primera mitad es la
  que corrige el modelo mental (no se crean, se generan) y la segunda nombra la condición exacta con la
  que el generador acepta un blueprint.
- **P5 · El vacío por filtros pierde el cuerpo.** Queda título + «Quitar filtros», como el implementado.
  El cuerpo anterior mentía con un total fijo y repetía la acción que el botón ya dice.
- **P6 · El modal del lote es el mismo componente con dos cuerpos** (`Ordenes-Lote.dc.html`, dos columnas
  de 360 px). Archivar pide un **motivo opcional en un textarea de 96 px** (los motivos reales son frases,
  no etiquetas) y sin asterisco de obligatorio. Tomar repite el radiogroup de `Ordenes-Tomar.dc.html`:
  «Yo (dev:ana)» primero y por defecto, «Un agente…» con el nombre validado y el literal
  `agent:<nombre>` en mono. El caso «sin handle» no se redibuja: es el mismo componente, ya dibujado.
- **P7 · El resultado por ítem son tres piezas en tres sitios.** (a) Lista **persistente**
  «Órdenes que no se pudieron actualizar» bajo la barra de filtros, con el id en mono y **el mensaje del
  servidor tal cual**; (b) toast efímero de una línea con el recuento y hasta 3 fallas nombradas; (c) el
  error del lote entero, dentro del modal, sin cerrarlo y conservando la selección. La lista es la que
  queda cuando el toast se va: un lote de 200 no cabe en un toast.
- **P8 · El recuento de la selección se dice una sola vez por ancho.** En escritorio, en la barra de
  lote. A 390 px, en la barra de selección de la tabla (que es la que trae el select-all); la barra de
  lote móvil lleva **solo las acciones**. Hoy el implementado lo dice en los dos sitios a la vez
  (`DataTable.tsx` `selectionBar` + `Ordenes.tsx` `batchCount`).
- **P9 · El checkbox nunca roba el click de la fila.** En escritorio vive en una columna de 40 px al
  inicio y su nombre accesible es «Seleccionar WO-310»; la fila sigue abriendo el drawer y el checkbox no
  propaga. En 390 px va en la tarjeta, a la izquierda del id, con 44 px de zona táctil.
- **P10 · La barra de lote móvil se pega sobre la barra inferior.** La lista es larga; si la acción vive
  al final del scroll, con 40 filas la selección se vuelve inútil. Tres controles de 44 px apilados.
- **P11 · El toast se corta a 480 px.** El mensaje real del servidor es largo
  (`cannot archive WO-301: status is done, expected pending, in_progress or out_of_sync`) y sin tope el
  toast de una falla ocupa media pantalla. Tope + elipsis; el texto completo vive en la lista.

## 3. Copy, por call site

| Sitio | Texto de la placa |
|---|---|
| Contador de la barra (escritorio) | `3 órdenes seleccionadas` / `1 orden seleccionada` |
| Barra de lote | `Archivar seleccionadas` · `Tomar seleccionadas` · `Limpiar selección` |
| Modal archivar | `Archivar órdenes` · `Las 3 órdenes seleccionadas salen de la lista activa y quedan en solo lectura en el grafo.` · `Motivo (opcional)` · `Cancelar` / `Archivar` |
| Modal tomar | `Tomar órdenes` · `Las 3 órdenes seleccionadas pasan a estar en curso, asignadas a quien elijas.` · `Yo (dev:ana)` / `Un agente…` · `Cancelar` / `Tomar órdenes` |
| Vacío sin órdenes | `Todavía no hay órdenes de trabajo para este proyecto` · `Las órdenes no se crean a mano: se generan del checklist ## Tareas de un blueprint publicado (un SDD o un ADR).` · `Ir a Construir` |
| Vacío por filtros | `Ninguna orden coincide con estos filtros` · `Quitar filtros` |
| Resultado por ítem | `Órdenes que no se pudieron actualizar` (nombre accesible de la lista) · fila: `WO-301 — <mensaje del servidor>` |
| Toast | `2 de 3 archivadas; no se pudieron archivar: WO-301 (<mensaje>)` |

## 4. Qué le falta a la app (volver como WO propio, no lo hace esta tarjeta)

1. **P8** — ocultar el contador de la barra de lote a ≤ 640 px (`Ordenes.module.css`), porque la barra de
   selección del `DataTable` ya lo dice.
2. **P11** — tope de 480 px + elipsis en el toast (`components/ToastProvider/ToastProvider.module.css`,
   componente compartido: el WO tiene que correr la suite de app completa).
3. **P12** — los mensajes por ítem llegan en inglés (`cannot archive WO-301: status is done…`) a una UI en
   español. La placa los dibuja tal cual porque es la verdad de hoy; traducirlos o mapearlos a copy propio
   es un cambio de servidor/contratos, fuera del alcance de una placa.

## 5. Limitaciones de esta ronda

- El runtime del canvas (`support.js`) no está en el repo (FB-268, abierto): la placa no se puede abrir
  renderizada desde el repo. Verifiqué con un intérprete mínimo de `sc-for` / `sc-if` / `{{ }}` fuera del
  repo y capturas headless de los cuatro estados; las capturas van adjuntas a la tarjeta.
- El paquete de diseño (`design/centurion-factory/src/features/ordenes/*`) sigue sin barra de lote ni
  vacío con salida: esta tarjeta toca `canvas/` únicamente. Alinearlo es trabajo de front, no de placa.
