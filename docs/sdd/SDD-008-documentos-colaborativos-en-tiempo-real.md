---
id: SDD-008
type: SDD
title: "Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios"
status: active
architects: ["PRD-005"]
impacts_paths: ["packages/collab/src/**", "packages/collab/tests/**", "packages/collab/*.json", "packages/contracts/src/**", "packages/contracts/tests/**", "packages/server/src/**", "packages/server/tests/**", "packages/server/*.json", "packages/db/src/**", "packages/db/tests/**", "packages/db/migrations/**", "packages/app/src/**", "packages/app/tests/**", "packages/app/*.json", "packages/app/*.config.ts", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.test.json", "vitest.config.ts", ".env.example", "README.md"]
created_at: 2026-09-13
tags: ["saas", "realtime", "yjs", "blame", "comments", "versions"]
---

## Contexto

PRD-005 pide edición simultánea de documentos con registro de quién tocó cada línea, versiones y comentarios. Stack en ADR-006 (Yjs + Hocuspocus 4.7.0 + CodeMirror 6). Los documentos, flujo y publicación son de SDD-007; la autorización, los roles y la suite de aislamiento, de SDD-006. Hoy `DraftStore` es "última escritura gana" (SDD-003) y no hay autoría por usuario.

## Representación del documento

Paquete isomórfico `packages/collab` (yjs 13.6.32, y-protocols 1.0.7). `Y.Doc` con `gc: false`:

- `Y.Map('fm')`: solo campos de frontmatter editables (título, relaciones, `tags`, `impacts_paths`, campos propios del kind), última escritura gana por clave; valores primitivos o arrays de strings.
- `Y.Text('body')`: el cuerpo Markdown tal cual.
- Solo esas dos raíces son válidas; cualquier otra raíz o tipo anidado en un update se rechaza.
- Los campos gestionados por el servidor (`id`, `type`, `status`, `closed_*`, `resolved_by`, `blueprint_hashes`, `assigned_to`, `claimed_at`, `completed_at`, `source_task`) viven en columnas y se mezclan al renderizar; `forbiddenFieldInjectionIssues` marca cualquier intento de inyectarlos.
- Proyección pura `projectDoc(ydoc) → {title, fields, body}` usada por validación, versiones, publicación, agente e importador.

CodeMirror 6 edita el texto sin transformaciones (una conversión rich text rompería `## Tareas` y los hashes de drift) y, al estar orientado a líneas, encaja con el blame.

**Invariante:** toda mutación de servidor sobre un documento con copia de trabajo (restaurar versión, aceptar propuesta del agente, escrituras del engine, importación) se aplica con `hocuspocus.openDirectConnection` como transacción atribuida; nunca con un `UPDATE` directo de `working_state`, que el documento en memoria sobrescribiría en el próximo store.

## Servidor de tiempo real

- Hocuspocus embebido en el mismo proceso Fastify: ruta `GET /collab` de `@fastify/websocket` 11.3.0 con `maxPayload` de 1 MiB que entrega el socket a Hocuspocus (confirmado por el learning test de ADR-006; plan B descrito allí).
- **Upgrade:** `Origin` obligatorio y exacto contra `PRDM_TRUSTED_ORIGINS` (sin `Origin` o con `null` se rechaza) y sesión de better-auth antes del handshake.
- **onAuthenticate** (una vez por documento, aunque el socket multiplexe varios): `documentName = <projectUuid>:<documentUuid>` resuelto con las funciones `SECURITY DEFINER` de SDD-006; membresía y documento dentro de `withTenantTx`; exige rol ≥ viewer; `readOnly` para viewer, commenter y developer, documentos `generated` y `archived`. Todos los miembros del proyecto pueden ver la copia de trabajo en solo lectura; los developers por MCP remoto siguen viendo solo lo publicado.
- **Revocación y revalidación:** quitar miembro, bajar rol, revocar sesión, cambiar contraseña o archivar cierra las conexiones afectadas (índice por usuario y documento); además cada conexión revalida sesión y rol cada 60 segundos.
- **Awareness y stateless:** `beforeHandleAwareness` descarta entradas cuyo client id no pertenece a la conexión y limita el estado a `{cursor, selection}` de hasta 2 KB; nombre y color salen del servidor. `onStateless` rechaza todo mensaje del cliente: el canal stateless es solo servidor → cliente; comentarios y acciones van por HTTP con CSRF.
- **Límites:** documento renderizado ≤ 512 KB; estado Yjs codificado (incluidas las eliminaciones) ≤ 20 MiB; ≤ 20 conexiones por usuario y 50 por documento; ≤ 30 updates por segundo por usuario (sumando todas sus conexiones) y ≤ 100 por documento. Superar un límite cierra la conexión y audita. Valores configurables por entorno. Un documento que alcanza el tope codificado por historial acumulado queda de solo lectura con aviso, y el escape es archivarlo y crear uno nuevo desde su última versión (límite aceptado del MVP). Una sola instancia en el MVP.

## Autoría por línea no falsificable

- **Vinculación de client id en `beforeSync`** (SyncStep2 y Update), **antes de aplicar** (Yjs no permite deshacer un update aplicado): el update se decodifica con `Y.decodeUpdate`/`Y.parseUpdateMeta` contra el state vector del servidor. Cada `client` de struct nuevo se liga al usuario autenticado (`doc_client_bindings`, clave `(document_id, client_id)`). Un struct de un client ligado a otro actor se acepta solo si ya está íntegramente contenido en el state vector del servidor (reenvío honesto tras un reinicio). Se rechaza todo update con structs ajenos no contenidos, que deje `pendingStructs` o con delete sets sobre clocks que el servidor no tiene; el rechazo cierra la conexión y se audita, y el provider recrea el `Y.Doc` con client id nuevo al reconectar.
- **Transacciones de servidor:** cada una usa un client id nuevo registrado en `doc_client_bindings` con su actor (`user` restaurando, `agent:deepseek` en nombre de un usuario, `system:import`, `system:engine`) antes de aplicarse.
- **Durabilidad:** `doc_updates` (actor, rangos `(client, clock, len)` insertados y delete sets, `received_at`) y los bindings se escriben de forma durable **antes** de difundir, agrupados en una transacción por frame o por tick de hasta 50 ms para acotar la escritura en la base compartida; el debounce aplica solo al snapshot `working_state`. Al cargar un documento se reaplican los `doc_updates` posteriores al snapshot.
- **Blame puro** en `packages/collab`: `blame(ydoc, index)` donde `index` mapea `(client, rango de clock)` → `{actor, received_at}` desde `doc_updates` (inserciones y delete sets). Por línea devuelve el actor y la fecha de la modificación más reciente según `received_at` (inserción en la línea, o borrado que la afectó, incluida la unión de dos líneas al borrar un salto); por clave de frontmatter, el último que la escribió. Undo y restauración se atribuyen a quien los ejecuta. El agente se muestra como "Agente (aceptado por Ana)".
- Endpoint de blame y aviso `blame:stale` por mensaje stateless tras cada store.

## Validación en vivo, versiones y comentarios

- **Validación:** tras cada store, `validateDocument` de SDD-007 en fase `edit` sobre la proyección, con el scan de publicados cacheado por `graph_version`; se guarda en `last_validation` y se difunde por mensaje stateless.
- **Versiones:** manuales con etiqueta y automáticas al pedir revisión, publicar, aceptar propuesta del agente, importar y restaurar; cada una guarda `Y.encodeSnapshot`, markdown renderizado, hash y contribuyentes desde la anterior. Diff por líneas entre versiones. Restaurar reconstruye con `Y.createDocFromSnapshot` y aplica la diferencia como transacción de servidor atribuida al usuario que restaura (no se reescribe la historia).
- **Comentarios** (`doc_comment_threads`, `doc_comments`): hilos anclados con `Y.RelativePosition` (inicio y fin) sobre el cuerpo; el texto citado lo calcula el servidor desde las anclas; responder, resolver, reabrir, borrar el propio (admin borra ajenos); commenter o superior; cuerpo ≤ 10 KB sin caracteres de control; aviso stateless a los conectados. Si el texto anclado desaparece, el hilo queda "sin ancla" pero visible. Acciones siempre por HTTP con rol re-leído en cada llamada.

## Editor (packages/app)

Encabezado con id, título, estado, presencia y acciones según rol; formulario de frontmatter validado con `@prdm/core/domain`; CodeMirror 6 (@codemirror/view 6.43.11, @codemirror/lang-markdown 6.5.2) con y-codemirror.next 0.3.6 y @hocuspocus/provider 4.7.0 (Vite con `resolve.dedupe: ['yjs']`), cursores, nonce de CSP y modo solo lectura; gutter de blame accesible por teclado; resaltado de comentarios; vista previa con react-markdown sin HTML crudo, sin imágenes remotas y con URLs completas visibles; paneles laterales Agente (SDD-009) | Comentarios | Versiones | Validación.

## Tests

Unitarios de proyección, blame (tablas con inserciones, borrados, unión de líneas, undo, restauración y transacción de servidor en nombre de un usuario), anclas y diff. Integración con servidor en proceso en puerto 0 y dos `HocuspocusProvider`: convergencia con ediciones concurrentes y reconexión offline, reinicio del servidor sin desconectar clientes honestos, atribución correcta, escrituras de viewer/commenter rechazadas, cliente malicioso con client id ajeno, awareness falsificado, mensajes stateless de cliente, límites excedidos, revocación. La espera es por eventos (`synced`, promesa de `onStoreDocument`), nunca por temporizadores. Casos de `documentName` en la suite de aislamiento de SDD-006. Cliente con jsdom y `Y.Doc` local; payloads XSS e imágenes remotas en la vista previa.

## Tareas

- [ ] Scaffold de packages/collab (yjs 13.6.32, y-protocols 1.0.7) con el esquema del Y.Doc (raíces fm y body, tipos permitidos) y proyección pura a título, campos y cuerpo, con tests
- [ ] Persistencia de Hocuspocus con snapshot working_state debounced, gc false y reaplicación de doc_updates al cargar, con tests de dos proveedores en proceso
- [ ] Montaje de Hocuspocus en /collab con maxPayload, Origin exacto y sesión validados en el upgrade, onAuthenticate por documento con funciones SECURITY DEFINER y conexión readOnly por rol, con tests
- [ ] Casos de documentName de otra organización y de otro proyecto en la suite de aislamiento
- [ ] Revocación en vivo por usuario y documento al quitar miembro, bajar rol, revocar sesión, cambiar contraseña o archivar, y revalidación periódica de sesión y rol, con tests
- [ ] Log de atribución doc_updates y doc_client_bindings escritos de forma durable antes de difundir, agrupados por frame o tick de hasta 50 ms, con tests
- [ ] Vinculación de client id en beforeSync antes de aplicar con aceptación de structs contenidos en el state vector del servidor, rechazo de pendingStructs y de delete sets desconocidos, cierre de conexión y client id nuevo por transacción de servidor, con tests de cliente malicioso y de reinicio
- [ ] Filtro de awareness por client id con estado acotado y rechazo de mensajes stateless de cliente, con tests
- [ ] Límites de tamaño renderizado y codificado con modo solo lectura al tope, conexiones por usuario y documento y tasa agregada de updates por usuario y por documento con cierre auditado, con tests de cliente abusivo
- [ ] Cálculo puro de blame por línea y por campo de frontmatter desde el índice de rangos de doc_updates, con tests de tabla de inserciones, borrados, unión de líneas, undo, restauración y agente
- [ ] Endpoint de blame y mensaje stateless blame:stale tras cada store, con tests
- [ ] Validación en vivo con validateDocument en fase edit tras cada store, scan de publicados cacheado por graph_version y difusión stateless, con tests
- [ ] Versiones manuales y automáticas con Y.encodeSnapshot, contribuyentes y diff por líneas, con tests
- [ ] Restauración de versión como transacción de servidor atribuida, con tests de blame
- [ ] Comentarios en hilos anclados con Y.RelativePosition y texto citado calculado por el servidor (responder, resolver, reabrir, borrar), con RLS, permisos y aviso stateless, con tests
- [ ] Editor CodeMirror 6 con y-codemirror.next 0.3.6, @hocuspocus/provider 4.7.0, presencia, nonce de CSP y modo solo lectura, con tests
- [ ] Formulario de frontmatter sobre el Y.Map validado con @prdm/core/domain sin campos gestionados por el servidor, con tests
- [ ] Gutter de blame accesible por teclado con autor, agente con quién aceptó y fecha, con tests
- [ ] Panel de comentarios en el editor, con tests
- [ ] Panel de versiones con diff y restauración, con tests
- [ ] Panel de validación con acciones de estado según permisos, con tests
- [ ] Vista previa markdown con react-markdown sin HTML crudo ni imágenes remotas y test con payloads XSS
- [ ] Tests de convergencia multi-cliente con ediciones concurrentes, reconexión offline, reinicio del servidor y blame correcto, esperando eventos y sin aserciones de tiempo de reloj
- [ ] Trigger para crear un hilo de comentario desde una selección de texto en el editor CodeMirror, llamando al endpoint de creación ya existente y refrescando el panel de comentarios, con tests
- [ ] Corregir el posicionamiento del tooltip visual del gutter de blame (el aria-label ya es correcto, pero el tooltip no se ve donde corresponde al hacer click), con test de posición relativa al marcador enfocado
- [ ] Eliminar el ruido espurio en el diff de versiones causado por normalizar comillas de valores YAML sin comillas (p. ej. `type: PRD` vs `type: "PRD"`) entre snapshots, con test de diff estable cuando el contenido no cambió
- [ ] Revisión de seguridad #2 (HIGH): en la restauración de versión, escribir de forma durable doc_updates y doc_client_bindings antes de aplicar la transacción en el Y.Doc en vivo y difundirla (hoy ocurre al revés, dejando una ventana sin fila de atribución si el proceso cae entre ambos pasos), con test de la condición de carrera entre una restauración y una edición concurrente del mismo documento
- [ ] Revisión de seguridad #2 (HIGH): límite de tasa por usuario y por documento en la creación y respuesta de hilos de comentarios (hoy solo hay un límite de tamaño de cuerpo, no de volumen), con test de un cliente abusivo
- [ ] Revisión de seguridad #2 (MEDIUM): conectar la revocación en vivo de /collab a los eventos de better-auth de revocación de sesión y cambio de contraseña, para que no dependan solo de la revalidación periódica de 60s como único mecanismo, con test de revocación instantánea por esos dos eventos
- [ ] Revisión de performance (HIGH): dejar de recodificar el estado completo de Yjs en cada beforeSync para el límite de tamaño; llevar un contador incremental de bytes actualizado solo cuando un batch de doc-update-writer confirma, con test de que el costo no crece con el historial acumulado
- [ ] Revisión de performance (HIGH): la cola de escritura durable de doc-update-writer serializa globalmente todos los documentos en una sola cadena de promesas en vez de una por documento, acoplando la latencia de un documento lento a la de todos los demás; cambiar a una cadena por documentId, con test de que dos documentos distintos no se bloquean entre sí
- [ ] Revisión de performance (HIGH): blame, restauración y anclaje de comentarios reconstruyen el Y.Doc completo desde cero releyendo todo doc_updates en cada llamada; cachear el Y.Doc reconstruido en proceso por snapshotSeq/maxSeq y solo reproducir la cola desde la última reconstrucción, con un test a escala sintética grande que verifique que la latencia no crece linealmente con el historial completo
- [ ] Revisión de performance (MEDIUM): eliminar el N+1 en el listado de hilos de comentarios (una consulta por hilo para traer sus comentarios); traerlos en una sola consulta agrupada, con test de conteo de queries
- [ ] Revisión de performance (MEDIUM): el listado y diff de versiones hace SELECT * sin paginar, trayendo yjsState y renderedMarkdown de cada versión aunque el listado no los use; seleccionar solo las columnas necesarias para el listado y paginar, con test
- [ ] Revisión de performance (LOW): eliminar el índice redundante en doc_updates.document_id, ya cubierto por el índice único compuesto (document_id, seq), con test de que la migración correspondiente no rompe las consultas existentes
