---
id: SDD-003
type: SDD
title: "Persistencia stateful de borradores en @prdm/core"
status: active
architects: ["FR-001"]
impacts_paths: ["packages/core/src/authoring/**", "packages/mcp/src/server.ts", "packages/core/src/scaffold/gitignore.ts", ".gitignore"]
created_at: 2026-09-13
tags: ["core", "resilience", "draft-store", "stateless-mcp"]
---

## Contexto

`DraftStore` (WO-013, endurecido en WO-023) es hoy un `Map` en memoria por proceso: TTL deslizante, límite de borradores y de bytes, tombstones de commit idempotentes. Si el servidor MCP se reinicia o se lo mata, todo el estado se pierde. FR-001 pide que un borrador sobreviva a ese reinicio sin perder trabajo intermedio.

No se adopta una base de datos nueva (se descartó SQLite del pedido original): el motor ya tiene un mecanismo de escritura atómica local (`safeCreateAtomic`/`safeReplaceAtomic`/`safeUnlink` en `util/safe-fs.ts`, usado también por el journal de WO-023) que resuelve exactamente este problema para los documentos versionados. Esta feature lo reutiliza para el estado de trabajo no versionado.

## Arquitectura

### Un archivo por borrador

`.prdm/drafts/<draftId>.json` (uno por borrador, nunca un archivo compartido): igual que el journal por transacción, evita que la escritura de un borrador interfiera con la de otro y hace trivial detectar y limpiar entradas individuales. `.prdm/**` ya está excluido del scan de documentos (`MANDATORY_IGNORE` en `config.ts`); se agrega a `.gitignore` (raíz y al que genera `prdm init`) porque es estado de trabajo, no fuente de verdad versionada.

Cada archivo serializa el `DraftRecord` completo (incluida su fase: abierto, o resuelto por un commit exitoso — ver Tombstones). No se separan borradores y tombstones en archivos distintos: un borrador transiciona de un estado al otro conservando su mismo archivo, hasta que el TTL lo expira y se borra.

### `DraftStore` pasa a ser durable y asíncrono

Las escrituras a `.prdm/drafts/` son E/S real, así que los métodos mutadores de `DraftStore` (`create`, `openUpdate`, `replace`, `remove`, `tombstone`) pasan de síncronos a `async`, y persisten antes de devolver el control: quien recibe la respuesta de `draft_artifact`/`commit_artifact` tiene la garantía de que ese estado ya está en disco (no es persistencia "en segundo plano"). `AuthoringService` ya es `async` en toda su superficie pública, así que este cambio no altera su API ni la de las tools MCP.

### Recuperación al arrancar

`DraftStore.open(limits, root, clock?)` (factory estática, mismo patrón que `Neo4jGraphDatabase.connect`) reemplaza al constructor público: lee `.prdm/drafts/*.json`, valida cada archivo contra el esquema de `DraftRecord` y lo carga en memoria; un archivo corrupto o con un borrador ya expirado se descarta (y se borra del disco si expiró) sin abortar el arranque, y se acumula como advertencia. Devuelve `{ store, warnings }`.

`packages/mcp/src/server.ts` es el único punto de construcción hoy (la autoría es exclusiva de MCP): pasa de `new DraftStore(config.authoring)` a `await DraftStore.open(config.authoring, config.project.root)`, y registra en stderr `n borrador(es) recuperado(s)` igual que ya loggea documentos indexados. La recuperación no empuja nada al cliente MCP: el asistente los descubre con `list_drafts` (o el propio prompt `author_artifact`) y decide si le conviene preguntar al usuario si quiere retomarlos — esa decisión es del asistente, no una regla fija del core (headless, ADR-002).

### Guardado incremental sin relajar la validación

`draft_artifact` ya admite actualizar un borrador existente por `draft_id` sin exigir que esté libre de issues (`validation.ok` puede ser `false` y aun así persistirse); esa validación en vivo es lo que lo hace útil, así que no se desactiva para el autoguardado. Lo único que cambia es que cada actualización queda en disco, no solo en memoria.

### Limpieza garantizada

`commit()` ya borra el registro en memoria tras un commit exitoso (`ops.remove`); el equivalente en disco (`safeUnlink` del archivo del borrador, o su reemplazo por el marcador de tombstone) ocurre en el mismo paso, después de que `engine.transaction` confirmó la escritura del documento final y el snapshot de Neo4j — nunca antes.

### Concurrencia

Cada borrador tiene un id aleatorio propio (`drf_` + 16 bytes), así que dos procesos nunca escriben el mismo archivo por accidente al abrir borradores distintos. Editar el *mismo* borrador desde dos procesos a la vez no está protegido por lock (no lo estaba tampoco en memoria): última escritura gana, documentado como límite conocido — la garantía real que pide FR-001 es sobrevivir a un reinicio, no edición concurrente multi-proceso del mismo borrador.

## Seguridad

- Las rutas de `.prdm/drafts/` se resuelven con `safeCreateAtomic`/`safeReplaceAtomic`/`safeUnlink`, que ya rechazan symlinks fuera del repo (mismas garantías que el journal, D10/D23 de ADR-002).
- Un archivo de borrador corrupto o manipulado a mano se descarta al cargar (falla el parseo del esquema), nunca se ejecuta ni se interpreta como comando: es JSON, no markdown con frontmatter, y no participa del mecanismo de journal/rollback (WO-023 restringió el journal a `.md` bajo `docs_dir`; los borradores quedan fuera de ese sistema a propósito).
- El tamaño de cada borrador sigue acotado por `config.authoring.maxDraftBytes` antes de escribir a disco.

## Tareas

- [ ] DraftStore.open (recuperación async desde .prdm/drafts) y métodos mutadores async persistiendo con safe-fs
- [ ] Wiring en el servidor MCP: DraftStore.open en el arranque y log de borradores recuperados
- [ ] .gitignore de este repo y del que genera prdm init excluyen .prdm/drafts/
- [ ] Tests de recuperación tras kill -9 simulado y de limpieza al commitear
