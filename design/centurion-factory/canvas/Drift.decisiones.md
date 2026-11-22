# Drift: decisiones de diseño (SDD-011 · WO-755, sobre SDD-070)

Placas: `Drift-Previews.dc.html` (pantalla base, nueva), `Drift.dc.html` (reconocer drift, refrescada) y `Drift-Detalle.dc.html` (detalle del reporte, nueva). Las tres en 1440 × 960.

> **Cómo se verificó.** El runtime de canvas no está disponible en el paquete (`support.js` no existe en `canvas/`), así que rendericé las tres placas con Chromium headless (Playwright del propio paquete) y busqué el texto esperado en el DOM: `PR #32`, `+2 vs main`, `0 vs main`, `-4 vs main`, `vista previa`, `Detalle del reporte`. Las capturas quedan como evidencia en la tarjeta `t_19045ae2`; no hay captura de la pantalla real `/drift` en esta pasada (la pasada de navegador fue el aterrizaje de WO-638).

## 1. Qué estaba desactualizado (evidencia)

- **El badge «vista previa» era una pastilla de control.** `canvas/Drift.dc.html` lo dibujaba con borde `1px #1F4FA0`, color de acento y radio 2 px — el mismo lenguaje que los botones reales de la cabecera. SDD-070 D5 lo pasó a texto apagado sin borde ni radio para que no compita con los controles, y así está en `packages/app/src/routes/drift/PreviewsByBranch.module.css:73-78`.
- **Sin delta.** El panel mostraba el conteo suelto (`2`, `0`), que no responde el job del developer (¿mi rama mejora o empeora antes de mergear?). D2 define `+N`/`-N`/`0` contra el reporte oficial, y su ausencia se dice con `—`.
- **La rama se leía cruda.** En producción esos reportes llegan con `branch = 32/merge` (el `GITHUB_REF_NAME` de un evento `pull_request`, o sea la ref `refs/pull/32/merge`), no con el nombre de una rama de trabajo. D3 lo muestra como `PR #32`.
- **La fila no era accionable.** En el código es un `<button>` que abre `ReportDetailModal` (D4); la placa no mostraba chevron, hover ni foco.
- **Sin orden peor-primero** (D6): el panel reordena por delta descendente.
- **Una fila que no existe.** La fila «Sin datos · Esperando reporte de CI» (`fix/scan-timeout`) no es una fila del panel: un reporte de preview siempre trae conteo y la espera de CI es un issue de la lista (`awaiting_ci_report`), que ya tiene su sección propia en la placa. Salió del panel.
- **Incoherencia del propio mock.** La lista de issues decía que `feat/fr-002-importer` esperaba un reporte de CI mientras el panel mostraba su reporte. La espera pasa a `fix/scan-timeout`, que es la rama sin reporte.
- **El detalle del reporte no estaba dibujado en ninguna placa**, aunque el modal existe desde SDD-013 y D7 le cambió la meta.

## 2. Decisiones

- **Referencia del delta.** El reporte oficial de la rama por defecto de la pantalla (la cabecera ya dice cuál es y a qué commit corresponde). En la placa el conteo oficial es 6, así que las tres filas quedan `+2 vs main`, `0 vs main` y `-4 vs main`. El delta es el conteo de dos números, no una promesa: el copy no afirma causalidad.
- **Tono del delta, no del conteo.** `+N` en `--paro` (`#B8322A`), `-N` en `--senal-texto` (`#19703F`), `0` en `--texto-secundario` (`#33383D`) y sin referencia en `--apagado` (`#565D63`). El conteo mantiene lo que ya hacía la placa: `0` en verde y cualquier otro valor en `--paro`.
- **Orden peor-primero** (D6): la rama que más empeora arriba. En la placa: `PR #32` (+2), `feat/fr-002-importer` (0), `feat/fr-003-avisos` (-4).
- **La fila es el control** (D4): la affordance es la fila entera — hover `--relleno`, `cursor: pointer`, anillo de foco `--focus-ring` y un chevron `›` `aria-hidden` al final. El badge no es un control, así que no se dibuja como tal.
- **El valor crudo sigue disponible** (D3): `title="Rama del reporte: 32/merge"`. El slug interno no se pierde, deja de ser lo que se lee.
- **La meta del detalle abre con la rama** (D7): `PR #32 · 6a9d2c1 · github-actions-previews · 8 issues`, con la etiqueta enlazada a GitHub cuando el proyecto conoce su repo; el resto queda igual (sha, token, conteo).
- **Tres placas, no una.** `Drift.dc.html` conserva su rol (la placa del modal Reconocer drift, como la referencia que cita `Ordenes-Archivar.dc.html:180`), y el panel se ve a contraste pleno en la placa base. El scrim de un modal no es lugar para discutir un cambio de panel.
- **No se dibuja el estado «sin reporte oficial»** (`— vs <rama>`). En este artboard hay reporte oficial; poner un `—` al lado de la cabecera sería dibujar una contradicción. Queda especificado en SDD-070 D2 y anotado en `canvas.json`.
- **Sin tiempo relativo.** La versión anterior mostraba «hace 22 min» en la fila; el panel real no lo muestra (la frescura vive en la cabecera y en el historial). La placa sigue al componente, no al revés.

## 3. Qué cambia respecto de hoy

| Antes (placa) | Ahora |
|---|---|
| Badge «vista previa» con borde cianotipo y radio | Texto apagado, 12 px, sin borde ni radio |
| Columna «Issues» con el conteo suelto | Conteo + segunda línea de delta (`+2 vs main`) |
| `feat/fr-002-importer` como nombre de rama | `PR #32` para `32/merge` (crudo en el `title`) |
| Filas inertes | Fila-botón con hover, foco y chevron |
| Orden del servidor (por antigüedad) | Orden por delta descendente (peor primero) |
| Fila «Sin datos · Esperando CI» en el panel | Fuera: la espera de CI es un issue, no una fila de preview |
| Sin placa del detalle del reporte | `Drift-Detalle.dc.html` con la rama al frente en la meta |

## 4. Quién decide qué

**Producto (prdm-pm) — decidido en esta pasada**

- Qué se dibuja y qué no (las tres placas) y que el estado sin reporte oficial no se finja.
- Que el badge deje de parecer un control y que la affordance la lleve la fila.
- El criterio de orden (peor primero) y el copy del delta (`+2 vs main`), incluido que no lleve separador de miles.
- Que la espera de CI no sea una fila de previews.

Todo esto ya venía decidido en SDD-070 D2-D7; acá se aplica a la placa y no se reabre.

**Front (prdm-frontend)**

- Alinear el mock del paquete de diseño con esta placa: `src/features/drift/BranchPreviews.tsx` + `BranchPreviews.module.css` y `src/data/drift.ts` (delta, `PR #32`, fila-botón, orden, y la rama del issue de espera de CI). Va en tarjeta hija de `t_19045ae2`; el mock sigue diciendo «from canvas/Drift.dc.html» y ya no coincide.
- Lo demás del CÓMO (375 px, tokens, a11y) ya está en el código de `packages/app` desde WO-636/637/638.

## 5. La acción de riesgo (SDD-122 · WO-796)

**Qué estaba mal en la placa.** El bloque de acciones del encabezado dibujaba `Ver historial` —un botón que no existe en la app— y `Reconocer drift`; el force-push, que sí existe y es la única acción irreversible de la pantalla, no estaba dibujado. Una placa que omite la acción de riesgo no sirve para decidir cómo se ve.

**Qué se dibuja ahora.** Las tres acciones reales, en su orden, con las variantes reales: `Actualizar reporte` (secundaria), `Autorizar force-push (destructivo)` (borde y texto `--paro`, fondo `--superficie`, el mismo tratamiento de `Button.module.css:40-48`) y `Reconocer drift` (primaria).

**Por qué el paréntesis y no otro verbo.** El riesgo tiene que leerse en el rótulo (FB-340), pero el admin conoce la acción como «Autorizar force-push» (es el título del modal y el nombre del endpoint). `(destructivo)` agrega la clase de riesgo sin romper ese vocabulario, igual que `(rama desconocida)` en la cabecera. La consecuencia exacta —la línea base pasa a ese commit y el permiso se consume una sola vez— va en el `title`, porque no cabe en una fila de botones.

**Lo que la placa no decide.** El apilado de la fila a 375 px (FB-306) y la variante destructiva rellena (FB-217) siguen abiertos; acá sólo se envuelve la fila (`flex-wrap`) para no ganar scroll horizontal con el rótulo nuevo.

## 6. Cuál total manda y qué hace «Releer» (SDD-114 · WO-773)

**Qué estaba mal en la placa.** Conviven tres números grandes en la pantalla (el total del reporte oficial, el de cada preview y el delta) y la placa no decía cuál era el estado vigente. El significado de «un preview es el drift de otro commit» vivía sólo en el `title` del badge `vista previa`, un tooltip que en táctil no existe. Y el botón de la cabecera decía `Actualizar reporte`, que promete una corrida nueva de CI, con la aclaración (`no dispara una corrida nueva`) también escondida en el `title` y en un `aria-label` que además no contenía el texto visible (incumplía WCAG 2.5.3 «Label in Name»).

**Qué se dibuja ahora.**

- **La leyenda del panel** (D1), debajo del `h2` y arriba de la cabecera de la tabla: `Cada fila es el drift de un PR sobre su propio commit: su total no tiene por qué coincidir con el de main. El delta se cuenta contra el reporte oficial de main (6 issues), que es el estado vigente.` El `6` es el conteo oficial del propio artboard (el mismo que hace que las filas den `+2`, `0` y `-4`), y `main` es la rama por defecto del proyecto, no un literal del componente. Sin reporte oficial la frase cambia a «…todavía no hay reporte oficial de <rama>, así que no hay contra qué contar el delta» y no imprime ningún número inventado. La única inflexión sobre el copy de SDD-114 es el singular cuando el oficial tiene un solo issue (`(1 issue)`, no `(1 issues)`), la misma regla que ya usa el resto de la pantalla.
- **El botón dice lo que hace** (D3): `Releer reporte de CI`, sin `aria-label` (el nombre accesible es el texto visible) y con el `title` intacto como descripción extra.
- **La línea visible** (D4) entre el encabezado y el aviso de reporte viejo: `Releer no dispara una corrida de CI: los números cambian cuando CI publica un reporte nuevo.` Aparece siempre; el aviso de >7 días (SDD-069) sigue apareciendo sólo cuando el reporte está viejo y está redactado distinto a propósito, para que no se lean como la misma frase repetida.
- **El badge `vista previa` pierde el `title`** (D2): la leyenda ya carga el significado. El `title` de la etiqueta de rama (`Rama del reporte: 32/merge`, el valor crudo) **se queda**: es dato auditable, no la explicación de la semántica.
- **El board de 375** (D6) está en la misma placa, debajo del de 1440: los tres botones apilados de a uno con 44 px de alto, la línea de «Releer» y la leyenda wrappeando sin scroll horizontal. El rótulo nuevo (21 caracteres contra 19) no cambia el apilado: los tres ya caían en filas separadas. `flex-wrap` en `.headerActions` ya venía de SDD-122 D4, así que no se tocó.

**Lo que se midió, no se estimó.** Sobre el build de este worktree servido en Chromium: a 375 px el bloque de acciones mide 343 px con 0 de overflow interno y los botones 44 px de alto; el panel mide 343 px con 0 de overflow y su leyenda 343 px (84 px de alto, sin recorte). A 1440 px el bloque mide 570 px (13 px más que los 557 px del rótulo viejo, por los 2 caracteres extra) y sigue en una sola fila. La placa reproduce esos números.

**Un defecto que la placa no puede tapar y este WO no toca.** El documento de la pantalla real **sí** desborda horizontalmente (147 px a 375, 94 px a 1440) por la tabla de **Historial**: sus 506 px intrínsecos no caben en la columna de 380 px (ni en la de 343 px del móvil). Es anterior a este WO — se midió igual sobre el build de `origin/main` (ab3473e) — y su arreglo es una decisión de diseño de la tabla (qué cede: la celda de commit con su botón de copiar y su enlace, o el ancho de la columna), no copy. Queda fuera de SDD-114 y se le pasa a producto.


