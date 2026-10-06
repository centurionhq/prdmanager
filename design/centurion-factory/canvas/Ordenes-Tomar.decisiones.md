# Órdenes: «Tomar orden» con dos formas y sin handle (SDD-086 §D2 / FB-146)

Comp: `Ordenes-Tomar.dc.html` (1440 x 960) — el modal en sus **tres estados** sobre la pantalla de
Órdenes con el drawer de `WO-311` abierto. El código vive en
`src/features/ordenes/TakeOrderModal.tsx` (paquete de diseño, datos mock: no toca `packages/app`).

## 1. Qué estaba desactualizado

- El paquete de diseño seguía con el modal viejo: un `<select>` alimentado por `ASSIGNABLE_ACTORS`
  (`agent:claude`, `agent:deepseek`, `dev:martin`, `dev:diego`). No existía «Yo», ni el caso «sin
  handle», y la lista además mentía por los dos lados: el dev real es el del token y un agente puede
  llamarse cualquier nombre válido.
- El canvas no tenía **ninguna** lámina de este modal: `Ordenes.dc.html` muestra el drawer sin
  overlay y `Ordenes-Archivar.dc.html` solo el archivado. La verdad visual del «Tomar orden» que
  quedó implementado en `packages/app` (commit `e6af9d2`, PR #80) no estaba dibujada en ninguna parte.

## 2. Decisiones

- **Una lámina, tres estados, no tres láminas.** El modal es una sola decisión de diseño con tres
  caras: con handle (por defecto «Yo»), con handle delegando a un agente, y sin handle. Las tres se
  leen juntas y comparan de un vistazo; separarlas en tres archivos obligaría a saltar de placa para
  entender la misma pieza. (Mismo criterio que la ronda B de `Login.dc.html`, que resolvió sus
  estados en una lámina, con las dos variantes una al lado de la otra.)
- **«Yo (dev:ana)» es la opción por defecto y va primero.** Tomar una orden para uno mismo es el caso
  común (SDD-086 §D2); delegar a un agente es la excepción y por eso pide un paso más (el nombre).
- **La sesión del demo tiene un solo lugar.** El handle es `ana` (`src/data/people.ts` → `dev:ana`),
  expuesto como `CURRENT_HANDLE` en `src/features/ordenes/actions.ts`; `CURRENT_ACTOR` (el filtro
  «Tomadas por mí») se deriva de él, así que el filtro y el «Yo» del modal no pueden discrepar.
- **El nombre del agente se valida al confirmar, no deshabilitando el botón.** Misma decisión que el
  implementado: un botón habilitado con el error visible explica qué falta; uno deshabilitado no dice
  nada. Charset `[A-Za-z0-9._-]{1,64}` — el mismo que acepta el servidor — y el valor se recorta
  antes de armar `agent:<nombre>`.
- **Sin handle, «Yo» queda deshabilitada con el motivo a la vista** («Definí tu handle en Ajustes ›
  Perfil.»), ligado por `aria-describedby` al `radiogroup`, y el formulario de agente **ya abierto**:
  no hay que elegir nada para poder seguir, y el aviso dice a dónde ir a arreglarlo.
- **El mono queda para el identificador, no para el campo.** El input del nombre es sans; el literal
  resultante (`agent:<nombre>`) y el SHA del modal *Completar* siguen en IBM Plex Mono, como manda
  CLAUDE.md.
- **Copy.** «WO-311 pasa a estar en curso, asignada a quien elijas.» (id en mono) y la ayuda «Se
  asigna como `agent:<nombre>`.». Sentence case, voz activa, sin emoji ni flechas.
- **El drawer de fondo es `WO-311`**, una orden `pending` de los mocks: es el estado del que sale este
  modal. (Las otras dos láminas de Órdenes dibujan `WO-310`, fuera de sincronía, que es de donde sale
  «Retomar»/«Archivar».)

## 3. Qué cambia respecto de hoy

| Hoy (paquete de diseño) | Ahora |
|---|---|
| `<select>` de 4 actores fijos, sin «Yo» | Radiogroup con «Yo (dev:ana)» por defecto y «Un agente…» con nombre validado |
| Sin caso «sin handle» | «Yo (sin handle)» deshabilitada + motivo visible + formulario de agente abierto |
| El modal no aparece en el canvas | Lámina `Ordenes-Tomar.dc.html` con los tres estados, registrada en `canvas.json` |
| Sin captura de este estado | Ruta de captura `ordenes-tomar` (`/ordenes?orden=WO-311` + click en «Tomar orden») |

## 4. Evidencia (WO-756)

- `npm test` y `npm run typecheck` del paquete de diseño en verde (los tests existentes se
  actualizaron — `OrderDrawer.test.tsx` ya no busca un `combobox` — y se sumó
  `tests/features/ordenes/TakeOrderModal.test.tsx` para los tres estados).
- Lámina: `canvas/Ordenes-Tomar.dc.html`; capturas: `screenshots/ordenes-tomar-desktop.png` y
  `screenshots/ordenes-tomar-mobile.png` (`npm run screenshots`).
