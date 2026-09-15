---
architects: ["PRD-007"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/package.json","packages/collab/src/**","packages/collab/tests/**","packages/server/tests/e2e/**","packages/server/tests/learning/**","package.json","package-lock.json","vitest.config.ts"]
tags: ["editor","collab","yjs","accessibility"]
id: "SDD-014"
type: "SDD"
title: "Editor de vista previa sin pérdida sobre Y.Text"
created_at: "2026-09-15"
---

## Contexto

ADR-009 decidió el enfoque: parsear el `Y.Text` real con `@lezer/markdown`, clasificar cada nodo como editable o isla de solo lectura, y aplicar cada edición como un splice mínimo en offsets exactos, en un origin de transacción propio (`PREVIEW_ORIGIN`) distinto al del `HocuspocusProvider`. Este SDD implementa esos módulos y los conecta a la pestaña "Vista previa" de Documento (SDD-013), reemplazando el `MarkdownPreview` de solo lectura que SDD-013 deja como puente temporal.

## Diseño

Módulos nuevos en `packages/app/src/editor/`:

| Módulo | Responsabilidad |
|---|---|
| `source-map.ts` | Clasificación de nodos y mapas de rango renderizado ↔ fuente |
| `edit-ops.ts` | Operaciones de edición puras, devuelven splices |
| `y-binding.ts` | Transacciones de Yjs, `Y.UndoManager` compartido |
| `dom-selection.ts` | Selección DOM ↔ offset de fuente |
| `PreviewEditor.tsx` | Render de bloques e islas, manejo de entrada |
| `Toolbar.tsx` | Controles de formato (se porta solo la parte visual del mock) |
| `remote-cursors.tsx` | Presencia de otros colaboradores vía `awareness` |

**Clasificación (`source-map.ts`).** Editable: párrafo, encabezados ATX 1 a 3, listas *tight* de un solo párrafo por ítem (con viñeta u ordenadas), ítems de tarea; inline: texto, énfasis, negrita, tachado, enlace inline, escape y salto suave (atómicos). Todo lo demás (tablas, code fences, HTML, imágenes, blockquotes, h4 a h6, Setext, listas anidadas o *loose*, link references) es una isla de solo lectura con la acción "Editar en Markdown", que cambia de pestaña y ubica el cursor de CodeMirror en la posición correspondiente.

**Operaciones de edición (`edit-ops.ts`), puras:**
- Insertar y borrar texto, escapando con backslash los caracteres significativos de Markdown y los marcadores de inicio de línea cuando corresponde.
- Partir un bloque (`\n\n`; dentro de una lista, `\n` más el mismo marcador, sin renumerar los ítems ordenados) y unir dos bloques (solo si el separador son líneas en blanco puras).
- Alternar una marca (negrita, cursiva, tachado) sobre la selección recortada de espacios, deshabilitado si la selección solapa parcialmente una marca existente.
- Cambiar el tipo de bloque, reescribiendo solo el prefijo de línea.
- Alternar una tarea, reemplazando un carácter.
- Insertar, editar y quitar un enlace, con `sanitizeHref` (http, https, mailto o relativo).
- El encabezado `## Tareas` no admite cambio de tipo ni de texto desde este editor.

**Vínculo con Yjs (`y-binding.ts`).** Cada operación se aplica con `ydoc.transact(fn, PREVIEW_ORIGIN)`. El `Y.UndoManager`, hoy instanciado dentro de `buildEditorExtensions` (SDD-008), se mueve al contexto de colaboración compartido por ambas pestañas, con `trackedOrigins` incluyendo el de ySync y `PREVIEW_ORIGIN`. El editor se vuelve a renderizar en cada `Y.Text.observe`; el cursor local se recalcula por offset, y el remoto se preserva con `Y.RelativePosition`.

**Entrada y seguridad (`PreviewEditor.tsx`, `dom-selection.ts`).** `beforeinput` siempre llama `preventDefault`; nunca se usa `innerHTML` ni `execCommand`; el contenido se renderiza como nodos de texto de React. Un `MutationObserver` revierte cualquier mutación fuera de ese flujo (por ejemplo, un `style` que el navegador intente inyectar, que la CSP bloquearía de todos modos). La composición IME se resuelve comparando el texto plano del bloque en `compositionend`. Pegar siempre inserta texto plano escapado; arrastrar contenido está deshabilitado.

**Colaboración y accesibilidad.** Los cursores remotos usan el mismo formato `{anchor, head}` de `awareness` que `y-codemirror.next`. El margen de blame por bloque y los resaltados de comentarios (por `startIndex`/`endIndex`) se portan del editor CodeMirror existente; un comentario puede crearse desde una selección hecha en Vista previa. Estados de solo lectura: scope `readonly` de colaboración, documento `generated` o `archived`, sin conexión, o en una pantalla móvil (ADR-009).

## Tests

Propiedades con `fast-check`: los bytes fuera del rango editado son idénticos byte a byte; los demás bloques vuelven a parsear igual; alternar una marca dos veces es la identidad. Test de corpus: cada archivo de `docs/**/*.md` de este repositorio se clasifica y mapea sin excepciones. Convergencia de dos `Y.Doc` en memoria. Integración con un Hocuspocus real embebido: una edición en Vista previa llega al servidor y el blame la atribuye al usuario correcto. E2E: una edición deja el resto del archivo intacto en la pestaña Markdown, un segundo usuario la ve, el blame la muestra, y cero violaciones de CSP durante la interacción.

## Tareas

- [ ] `source-map.ts`: clasificación y mapas de rango, con las propiedades de round-trip y el test de corpus sobre `docs/**`
- [ ] `edit-ops.ts`: cada operación con sus propiedades de preservación de bytes
- [ ] `y-binding.ts` y el `Y.UndoManager` compartido movido al contexto de colaboración; test de convergencia de dos `Y.Doc` y test de integración con Hocuspocus real (la actualización se envía, el blame atribuye al usuario)
- [ ] `PreviewEditor.tsx`: render de bloques e islas, con "Editar en Markdown" ubicando el cursor de CodeMirror en la posición correcta
- [ ] Entrada: `beforeinput` a operaciones, mapeo de selección DOM ↔ fuente, restauración del cursor
- [ ] Composición IME, pegado como texto plano escapado, arrastre deshabilitado, y el `MutationObserver` que revierte mutaciones fuera de flujo
- [ ] `Toolbar.tsx`: marcas, tipos de bloque, tarea, popover de enlace, bloqueo del encabezado `## Tareas`, atajos de teclado, `aria-pressed`
- [ ] `remote-cursors.tsx`: presencia vía `awareness`
- [ ] Margen de blame por bloque, resaltados de comentarios, y crear un comentario desde una selección de Vista previa
- [ ] Estados de solo lectura: `readonly` de colaboración, `generated`/`archived`, sin conexión, mobile
- [ ] Conectar `PreviewEditor` como la pestaña "Vista previa" por defecto de Documento, reemplazando el `MarkdownPreview` puente de SDD-013
- [ ] Presupuesto de rendimiento: un documento de 200 KB parsea y re-renderiza un cambio incremental en menos de 16 ms
- [ ] E2E: una edición en Vista previa deja el resto del archivo idéntico en Markdown, un segundo usuario la ve, el blame la atribuye, cero violaciones de CSP
- [ ] Gate: revisión de seguridad (XSS, CSP)
- [ ] Gate: auditoría de accesibilidad
- [ ] Gate: correcciones del code review
