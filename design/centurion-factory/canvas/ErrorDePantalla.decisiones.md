# ErrorDePantalla: decisiones de diseño

Comp: `ErrorDePantalla.dc.html` (escritorio 1440 y móvil 375, con selector de vista y de estado arriba, solo para la maqueta). Es un estado nuevo: no había artboard previo.

> **Limitaciones de esta pasada.** (1) No pude provocar un error de render real en producción sin tocar código, así que **no hay captura del «Unexpected Application Error!»**: ese punto se toma del brief y de que `packages/app/src` no tiene ningún `errorElement` ni `ErrorBoundary`. (2) Sí vi en vivo la placa 404 dentro del shell (1440 y 375) y la pantalla de Órdenes a 1440. (3) No abrí el comp en el runtime de canvas (`support.js` no está en la carpeta): la sintaxis `sc-if`/`sc-for` copia la de `Login.dc.html`, pero falta verlo renderizado. Antes de aprobar hay que contrastarlo con el runtime.
> **Actualizado en WO-744 (2026-10-06).** El artboard quedó registrado en `canvas.json` (página «Pantallas», al lado de «Órdenes · archivar orden»). El comp se corrigió con el QUÉ de SDD-103 (D1/D3/D5): el cuerpo ya no promete «tu trabajo está a salvo», se fue el paso «avisanos con este código» (ese canal no existe) y se fue el estado «sigue fallando». El `errorElement` va en una ruta **sin `path` un nivel DEBAJO de cada shell**, nunca en la ruta del shell: declararlo en el shell reemplazaría el chrome entero, que es exactamente el bug de FB-189.

## 1. Qué se veía mal

- **Se pierde todo el shell.** Hoy un error de render hace que React Router reemplace la UI completa por «Unexpected Application Error!». No hay sidebar, ni barra inferior, ni forma de navegar. Evidencia: en el repo no existe `errorElement`/`ErrorBoundary`; en cambio, la 404 sí vive dentro de `main#contenido` y conserva el sidebar (verificado en `/ruta-que-no-existe`).
- **Copy técnico.** Mensaje del motor y stack minificado: no le dice nada a una persona de negocio ni de producto.
- **Sin salida.** Ningún botón ni enlace. Quien llega ahí solo puede editar la URL a mano.
- **Sin forma de reportarlo.** El stack no se puede pasar a nadie de manera útil; no hay un código corto.
- **Referencia viva (404).** La placa ya tiene buen esqueleto, pero la lista de destinos ocupa 6 filas de 48 px (~300 px) y empuja lo importante; una acción de salida no debería competir con seis enlaces iguales.

## 2. Decisiones

- **Dentro del chrome.** El sidebar (escritorio) y la barra inferior de 64 px (móvil, con encabezado «Órdenes de trabajo») quedan intactos. El error ocupa solo el área de contenido, así que la navegación sobrevive y «Órdenes de trabajo» sigue marcada como actual.
- **Misma familia que la 404.** Se reusa la geometría de `NotFoundPanel`: `page` centrado, tarjeta de `32rem`, `--superficie`, regla de 1 px, radio 2 px, padding 24 px (16 px en móvil). Lo nuevo es una marca `--paro` de 8 px (cuadrado, mismo lenguaje que `ErrorState`) con el texto «Algo salió mal», para que el color no sea el único portador del mensaje.
- **Jerarquía.** Marca (14/600) → título 20/700 «No pudimos mostrar esta pantalla» → el cuerpo de SDD-103 D3 → código → acciones. Un solo primario por pantalla. El cuerpo no promete que el trabajo esté a salvo: no es verificable en una pantalla de edición (decisión de producto, D3).
- **Copy llano.** Sentence case, voseo, nada de «excepción», «render», «stack» ni «500». El cuerpo no nombra la pantalla afectada (el copy de D3 habla de «esta pantalla»).
- **Código copiable.** Mismo formato que `CopyBlock`: texto literal en `IBM Plex Mono` seleccionable (`user-select: all`) y botón «Copiar» de 44 px. Etiqueta «Código del error» y «No incluye tus datos. Pasale este código a quien administra el proyecto.» (D3). El texto nunca depende del botón. El código tiene la forma `ERR-XXXX-XXXX`; en pantalla va **sólo** el código, y el error real se registra con `console.error('[route-error] ERR-…', error)` (D4).
- **Acciones.** «Reintentar» (primario, `--cianotipo`), «Ir a la Planta» e «Ir a Documentos» (secundarios). Un reintento recarga la ruta sin perder el shell. En móvil se apilan a ancho completo; en escritorio van en fila. En el nivel organización (sin proyecto elegido) el primario es «Reintentar» y la salida «Ver los proyectos de <organización>».
- **Salidas reusando la placa (paridad con lo implementado).** Las salidas se dibujan con el `action` (enlace de salida, nivel organización) y los `destinations` (la lista vertical de enlaces de 44 px) que ya usa la 404, como manda SDD-103 D2 — no con la fila de botones secundarios de este comp. La placa conserva también la geometría y el espaciado de SDD-071 (gap de 12 px), así que no lleva la regla `--regla-fila` que se dibujó entre el código y las acciones: lo que manda es la familia de la 404.
- **Espaciado y tipografía.** Solo escala 4/8/12/16/24/32. Gap de 16 px entre bloques, 8 px dentro de cada bloque, una regla `--regla-fila` antes de las acciones. Cuerpo 14 px en escritorio y 16 px en móvil (evita zoom y mejora lectura); notas 12 px y 14 px en móvil.
- **Estados.** Error base; código copiado («Copiado», verde `--senal-texto`, más `role="status"`); no se pudo copiar (texto `--paro` que manda a seleccionar a mano); reintentando (botón deshabilitado con spinner, que respeta `prefers-reduced-motion`). El estado «sigue fallando» quedó **fuera de alcance** (SDD-103 D5): si vuelve a fallar, la placa reaparece con un código nuevo.
- **A11y.** `role="alert"` en la tarjeta, `aria-labelledby` al título, foco visible con `--focus-ring` en todo, targets de 44 px (control-height pasa a 44 en móvil), 375 px sin scroll horizontal (`min-width: 0`, `overflow-wrap: anywhere`, columna única). Pares de contraste ya probados: `--grafito`/`--superficie`, `--apagado`/`--superficie`, `--paro` y `--senal-texto` sobre claro, blanco sobre `--cianotipo`.

## 3. Qué cambia respecto de hoy

| Hoy | Propuesto |
|---|---|
| Se reemplaza toda la UI: sin sidebar ni barra inferior | El shell queda; el error vive en el área de contenido |
| «Unexpected Application Error!» + stack minificado | «No pudimos mostrar esta pantalla» + qué pasó, qué hacer |
| Sin botones | Reintentar, Ir a la Planta, Ir a Documentos |
| Sin identificador | Código `ERR-…` copiable, sin datos del usuario |
| Sin estados | Copiado, copia fallida, reintentando |

## 4. Quién decide qué

**Producto (prdm-pm)**
- El copy completo, tal como quedó en SDD-103 D3. La promesa «Tu trabajo está a salvo» quedó **descartada**: no es verificable en una pantalla de edición.
- Qué destinos de salida ofrecer: se propone Planta y Documentos; la 404 usa los seis.
- A quién se le pasa el código («quien administra el proyecto»): ¿hay un canal de soporte o un enlace a Feedback?
- Si el código debe correlacionarse con un registro en servidor (hoy el comp solo asume que existe).

**Front (prdm-frontend)**

- El `errorElement` va en una ruta **sin `path` un nivel DEBAJO de cada shell** —una por shell— y hay un último recurso en la raíz (SDD-103 D1). Entre sus hijos queda el `Outlet` completo, así que el shell sigue montado y el panel ocupa sólo el área de contenido. Declararlo en la ruta del shell (como decía esta nota) reemplazaría el chrome entero: **descartado**. El último recurso, sin chrome, dibuja la misma tarjeta sin navegación.
- `NotFoundPanel` extendido con `mark`/`code`/`onRetry`/`alert` (no un `ErrorPanel` nuevo), reusando `useCopyToClipboard` para el código.
- El código se genera con formato `ERR-XXXX-XXXX` y se registra en consola con el error real (`console.error('[route-error] ERR-…', error)`); en pantalla nunca se muestra `error.message` ni el stack (salvo bajo `import.meta.env.DEV`).
- «Reintentar» reintenta de verdad y el panel se limpia al navegar (SDD-103 D6, probado en el test integrado).
- Foco al título al aparecer (`tabIndex=-1`, `role="alert"`).
- Artboard registrado en `canvas.json` (página «Pantallas») y los 4 estados del comp (error, copiado, copia fallida, reintentando) cerrados sin scroll horizontal a 375 px.

**Respuestas a lo que esta nota dejaba abierto (SDD-103)**

- Destinos de salida: Planta y Documentos en el nivel proyecto; «Ver los proyectos de <organización>» en el nivel organización.
- Canal de soporte: **no existe** hoy, así que no se inventa: el código se pasa a quien administra el proyecto.
- Correlación en servidor del código: **fuera de alcance** (cero cambios de servidor, SDD-103 D4) — el código es un identificador de la pantalla, no un registro.
