---
architects: ["PRD-007"]
impacts_paths: ["packages/app/package.json","packages/app/tests/unit/**","packages/server/tests/learning/**","package.json","package-lock.json"]
tags: ["architecture-decision","editor","collab","saas"]
id: "ADR-009"
type: "ADR"
title: "Vista previa editable sin pérdida sobre Y.Text"
created_at: "2026-09-15"
---

## Contexto

PRD-006 pidió que la pestaña "Vista previa" del editor de documentos se comporte como un editor de texto común (títulos, negrita, listas) con Markdown como segunda pestaña. El mock de `design/centurion-factory` lo resolvió con un modelo de bloques (`DocumentBlock[]`) serializado a mano: parsea línea por línea con expresiones regulares y reescribe el documento entero en cada cambio de bloque.

Ese enfoque no sirve sobre el documento real. El cuerpo vive en `Y.Text('body')` dentro de un `Y.Doc` compartido por Hocuspocus (SDD-008): cualquier reescritura completa del texto se propaga a todos los colaboradores como un borrado y reinserción masivos, lo que rompe la autoría por línea (`beforeSync`/`doc_client_bindings`), invalida los `Y.RelativePosition` de los comentarios anclados y cambia el hash de contenido usado por drift y por `## Tareas`. Además usa `element.innerHTML` para aplicar formato, lo que abre XSS si el contenido lo tocó otro colaborador o el agente.

ADR-006 ya evaluó y descartó TipTap para este mismo editor exactamente por esta razón: la ida y vuelta a Markdown de un editor rich-text normaliza listas y `- [ ]`, rompiendo `## Tareas` y los hashes de drift. Esta decisión no revierte esa conclusión: TipTap sigue descartado. Lo que cambia es el enfoque — en vez de un modelo rich-text con serializador propio, se edita el `Y.Text` original con operaciones mínimas en offsets de código fuente exactos, así que los bytes no tocados por el usuario nunca cambian.

`packages/app` ya usa CodeMirror 6 con `@codemirror/lang-markdown` (que internamente usa `@lezer/markdown`) y `y-codemirror.next` para la pestaña Markdown (SDD-008). La Vista previa nueva reutiliza el mismo árbol de sintaxis en vez de sumar un segundo parser.

## Opciones consideradas

| Tema | Opción | Pros | Contras |
|---|---|---|---|
| Modelo de edición | Rich-text con serializador propio (el enfoque del mock) | Simple de implementar | Reescribe el documento completo en cada cambio; rompe blame, anclas de comentarios y hashes; ya evaluado y descartado en la práctica por PRD-006/ADR-006 |
| Modelo de edición | TipTap/ProseMirror sobre una conversión Markdown↔JSON | Editor WYSIWYG maduro | Serializa el documento entero (mismo problema que ADR-006 ya rechazó); no expone offsets de fuente estables |
| Modelo de edición | **Parsear `Y.Text` con `@lezer/markdown` (con `GFM` `TaskList`/`Strikethrough`) y editar con splices mínimos en offsets exactos** | Reutiliza el parser que ya trae `@codemirror/lang-markdown`; cada nodo del árbol trae `from`/`to` en el texto fuente; un cambio nunca toca bytes fuera del rango editado | El árbol hay que reconstruirlo en cada `Y.Text.observe`; requiere un modelo de "islas de solo lectura" para lo no soportado |
| Parser alternativo | micromark/mdast-util-from-markdown | Buen soporte de posiciones | Un segundo parser de Markdown en el bundle, redundante con el que ya usa CodeMirror |
| Alcance editable | Soportar todo CommonMark+GFM en la vista previa | Máxima fidelidad visual | Tablas, code fences, HTML y listas anidadas no tienen una representación de edición segura sin arriesgar la ida y vuelta; alto costo para poco beneficio, dado que esos casos ya se editan bien en la pestaña Markdown |
| Alcance editable | **Subconjunto seguro editable (párrafos, h1–h3, listas simples de un párrafo, tareas, negrita/cursiva/tachado, enlaces) + islas de solo lectura para el resto, con acceso directo a "Editar en Markdown"** | Cubre el caso de uso pedido ("como un editor de texto común") sin arriesgar los bytes de construcciones complejas | La vista previa no es 100% WYSIWYG para todo el documento |
| Transacción de Yjs | Reusar el origin del `HocuspocusProvider` | Un solo origin en el sistema | El provider ignora las actualizaciones que se originan en sí mismo (`documentUpdateHandler` corta si `origin === this`), así que la edición nunca se enviaría al servidor |
| Transacción de Yjs | **Un origin propio (`PREVIEW_ORIGIN`) registrado en el mismo `Y.UndoManager` que ySync** | Se envía al servidor con normalidad; blame sigue funcionando porque se basa en el `clientID` del `Y.Doc`, no en el origin; undo queda coherente entre pestañas | Hay que mantener sincronizados los `trackedOrigins` de ambos módulos |
| Edición del DOM | contentEditable con `execCommand`/`innerHTML` (como el mock) | Menos código | El navegador decide qué HTML insertar (incluye `<span style>`, que la CSP bloquea) y no hay forma de mapear el resultado a offsets exactos de manera confiable; XSS con contenido remoto |
| Edición del DOM | **`beforeinput` interceptado con `preventDefault`, texto renderizado como nodos de React, un `MutationObserver` que revierte cualquier mutación fuera de ese flujo** | Cada tecleo se traduce a una operación pura y determinística antes de tocar el DOM; nunca se usa `innerHTML` | Hay que resolver a mano composición IME, pegado y arrastre |

## Decisión

- **Parser:** `@lezer/markdown` (versión exacta fijada), con las extensiones GFM `TaskList` y `Strikethrough` que CodeMirror ya usa en la pestaña Markdown. El árbol se reconstruye en cada `Y.Text.observe`.
- **Bloques editables:** párrafo, encabezados ATX 1 a 3, listas con viñetas u ordenadas *tight* de un solo párrafo por ítem, e ítems de tarea. Contenido inline editable: texto plano, énfasis, negrita, tachado, enlaces inline, escapes y saltos de línea suaves (estos últimos dos, atómicos).
- **Islas de solo lectura:** tablas, code fences, HTML crudo, imágenes, blockquotes, encabezados h4 a h6, encabezados Setext, listas anidadas o *loose*, y link references. Se muestran renderizadas y de solo lectura, con una acción "Editar en Markdown" que cambia a esa pestaña y ubica el cursor de CodeMirror en la posición correspondiente.
- **Operaciones de edición:** puras, devuelven splices `(offset, largoABorrar, textoAInsertar)`. `beforeinput` nunca deja que el navegador mute el DOM (`preventDefault` siempre). Insertar texto escapa con backslash los caracteres significativos de Markdown y los marcadores de inicio de línea (`#`, `-`, `+`, `N.`) cuando corresponde. Cambiar el tipo de bloque reescribe solo el prefijo de línea. El encabezado `## Tareas` no admite cambiar su tipo ni su texto desde la vista previa.
- **Transacción:** las operaciones se aplican con `ydoc.transact(fn, PREVIEW_ORIGIN)`, un origin propio y distinto al del `HocuspocusProvider`. El `Y.UndoManager` compartido por ambas pestañas trackea tanto el origin de ySync como `PREVIEW_ORIGIN`.
- **Seguridad de entrada:** nunca se usa `innerHTML` ni `execCommand`. El contenido se renderiza como nodos de texto de React. Un `MutationObserver` revierte cualquier mutación del DOM que no haya pasado por el flujo de operaciones (por ejemplo, un `<span style>` que el navegador intente insertar), que además la CSP (`style-src 'self' 'nonce-…'`, sin `'unsafe-inline'`) bloquearía igual.
- **Colaboración:** composición IME se resuelve comparando el texto plano del bloque en `compositionend`. Pegar siempre inserta texto plano escapado; arrastrar y soltar contenido está deshabilitado. Los cursores remotos usan el mismo formato de `awareness` que `y-codemirror.next`, así que un usuario en Vista previa y otro en Markdown se ven mutuamente.
- **Mobile:** la Vista previa editable es de escritorio. En mobile es de solo lectura (con el mismo botón "Editar en Markdown"), porque el comportamiento de `beforeinput` e IME en teclados Android no es confiable; se confirma con el usuario en la ronda de canvas de SDD-013.
- **Autoría, comentarios y validación:** sin cambios respecto a SDD-008 — siguen basados en el `Y.Doc` real, no en un modelo paralelo.

## Consecuencias

- Esta decisión **supera parcialmente** el renglón "Editor" de ADR-006: la conclusión de que un editor rich-text con serialización propia (TipTap incluido) rompe `## Tareas` y los hashes de drift sigue vigente y es la premisa de este ADR, no algo que se revierte. Lo que cambia es que ahora existe una vista previa editable segura, construida como una superposición sobre el mismo `Y.Text`, en vez de descartar por completo la posibilidad de editar visualmente.
- `@lezer/markdown` pasa de dependencia transitiva (vía `@codemirror/lang-markdown`) a dependencia directa y fijada en versión exacta de `packages/app`.
- Se agrega `fast-check` como dependencia de test para las propiedades de preservación de bytes.
- El editor no puede considerarse "WYSIWYG completo": documentos con tablas, code fences o listas anidadas se siguen editando en Markdown para esas partes. Esto se comunica en la interfaz, no se oculta.

## Tareas

- [ ] Learning test: parsear con `@lezer/markdown` (con `TaskList` y `Strikethrough`) el corpus completo `docs/**/*.md` de este repositorio y verificar que los rangos `from`/`to` de cada nodo de nivel superior están ordenados, son contiguos y que `body.slice(from, to)` reproduce exactamente el bloque esperado
- [ ] Learning test con Playwright: disparar cada `inputType` relevante de `beforeinput` (inserción, borrado, con y sin composición IME) en Chromium y Firefox sobre un `contentEditable` con `preventDefault` incondicional, y confirmar que el DOM permanece sin mutar en todos los casos
- [ ] Agregar `@lezer/markdown` como dependencia directa fijada en la versión exacta ya resuelta transitivamente, y `fast-check` como dependencia de test
