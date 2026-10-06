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
