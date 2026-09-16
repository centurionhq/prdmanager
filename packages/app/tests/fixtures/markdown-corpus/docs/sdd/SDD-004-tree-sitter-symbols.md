---
id: SDD-004
type: SDD
title: "Extracción de símbolos con Tree-sitter"
status: active
architects: ["PRD-003"]
impacts_paths: ["packages/core/src/sync/code-refs.ts", "packages/core/src/sync/symbol-extractor.ts", "packages/core/src/sync/tree-sitter-extractor.ts", "packages/core/src/sync/legacy-extractor.ts", "packages/core/src/sync/symbol-cache.ts", "packages/core/src/engine.ts", "packages/core/src/index.ts", "packages/core/src/scaffold/gitignore.ts", ".gitignore", "packages/core/package.json", "packages/core/src/sync/code-refs.ts#resolveGoverned"]
created_at: 2026-09-13
tags: ["parser", "tree-sitter", "drift", "dogfooding"]
---

## Contexto

`resolveGoverned` (`packages/core/src/sync/code-refs.ts`) hashea el archivo o símbolo (`path#símbolo`) que un blueprint gobierna. Hoy `extractSymbol` es un conjunto de heurísticas de texto: regex por lenguaje, conteo de llaves con `sanitizeLine`/`skipStringLiteral` para ignorar strings y comentarios, preferencia por la declaración de nivel superior por indentación, encadenado de overloads de TypeScript, decoradores de Python por indentación, y un fallback a fin de archivo si un bloque no cierra. Funciona (11 casos de test la cubren) pero es una aproximación de texto a algo que ya tiene un parser real.

Runtime elegido en ADR-003: `web-tree-sitter` 0.25.10 + `tree-sitter-wasms` 0.1.13.

**Hallazgo clave:** ningún blueprint de este repo usa hoy un `impacts_paths` con sufijo `#símbolo` (todos son archivos o globs). El cambio de extractor no genera drift de baseline en `prdmanager` — el "plan de re-baseline versionado" que pide PRD-003 se documenta para quien adopte símbolos más adelante, sin construir una migración que hoy no tiene nada que migrar (YAGNI).

## Arquitectura

### `SymbolExtractor` (interfaz, `symbol-extractor.ts`)

```ts
export interface SymbolExtractor {
  /** Devuelve el bloque de texto del símbolo (sin normalizar) o null si el archivo no lo contiene. */
  extract(content: string, symbol: string, path: string): string | null;
}
```

`hashRef` en `code-refs.ts` no cambia su contrato: sigue llamando a `normalizeText` + `sha256` sobre lo que el extractor devuelve.

### `LegacySymbolExtractor` (`legacy-extractor.ts`)

Todo el código heurístico actual (`tsDeclRegex`, `pyDeclRegex`, `findTopLevelDecl`, `tsBlockEnd`, `functionLikeBlockEnd`, `singleDeclBlockEnd`, `sanitizeLine`, `skipStringLiteral`, `pythonDeclStart`, `pythonBlockEnd`, `IDENTIFIER`, `CONTINUATION_SUFFIXES`/`CONTINUATION_PREFIXES`) se mueve tal cual a esta clase. Los 11 casos de `code-refs.test.ts` para `extractSymbol` pasan sin cambios contra ella — es un movimiento, no una reescritura. Queda como fallback para extensiones sin grammar Tree-sitter.

### `TreeSitterSymbolExtractor` (`tree-sitter-extractor.ts`)

- `TreeSitterSymbolExtractor.create()` (factory async) corre `Parser.init()` una vez y precarga los 4 `Language` soportados (`typescript`, `tsx`, `javascript`, `python`) vía `import.meta.resolve('tree-sitter-wasms/out/tree-sitter-<lenguaje>.wasm')` (ADR-003), guardados en un `Map<extensión, Language>`. El propio `SymbolExtractor.extract` sigue siendo síncrono (no puede cargar un grammar a mitad de una llamada), así que la unidad de "perezoso" es el proceso completo: nada de Tree-sitter se toca hasta que algo pide un `TreeSitterSymbolExtractor`, no cada lenguaje por separado.
- Mapa de extensión a lenguaje: `.ts/.mts/.cts` → `typescript`; `.tsx` → `tsx`; `.js/.jsx/.mjs/.cjs` → `javascript`; `.py` → `python`. Extensión sin grammar → `extract()` devuelve `null` y `resolveGoverned` cae a `LegacySymbolExtractor` para ese archivo.
- Una `Query` por lenguaje sobre declaraciones top-level con nombre (`function_declaration`, `class_declaration`, `interface_declaration`, `type_alias_declaration`, `enum_declaration`, `variable_declarator` para TS/JS; `function_definition`, `class_definition` para Python, con `decorated_definition` como ancestro si existe). Entre los matches cuyo `@name` coincide con el símbolo pedido, se prefiere el nodo con menor profundidad de ancestros (top-level real por AST, no por indentación de texto), y ante empate el de menor `startIndex` (primera aparición) — mismo criterio de desempate que la heurística.
- Overloads de TypeScript: si el nodo encontrado es una firma sin cuerpo (`function_signature`), el rango se extiende hacia adelante por los hermanos siguientes del mismo nombre hasta la implementación (`function_declaration`) o hasta la última firma si no hay implementación — mismo resultado observable que el encadenado heurístico actual, calculado por AST en vez de por texto.
- El texto devuelto reconstruye por posición (fila/columna) del AST, no por offset de bytes (evita el desajuste UTF-8/UTF-16); no se incluyen comentarios/JSDoc que preceden a la declaración (la heurística actual tampoco los incluye, salvo decoradores de Python, que sí quedan cubiertos por `decorated_definition`).
- Divergencia real encontrada y documentada en la comparación (`symbol-extractor-comparison.test.ts`): una línea con forma de declaración *dentro de un template literal* engaña a la heurística basada en texto (nunca sanitiza strings antes de buscar la declaración inicial) y le hace devolver el bloque equivocado; Tree-sitter, al operar sobre el AST real, nunca cae en ese error — un bug real que esta migración corrige, no solo una reescritura equivalente.

### Selección de extractor

`resolveGoverned` recibe por defecto un extractor que dispatch-ea a `TreeSitterSymbolExtractor` para las extensiones soportadas y cae a `LegacySymbolExtractor` en cualquier otro caso; la carga de Tree-sitter es perezosa a nivel de proceso (solo la primera vez que se resuelve un patrón `#símbolo`). La firma admite `{ extractor?, cache? }` para inyectar overrides en tests o en la comparación de hashes.

### Caché de símbolos (`symbol-cache.ts`)

Costo real a evitar: el hook `post-commit` corre `prdm sync` después de cada commit, y cada corrida vuelve a parsear con Tree-sitter todos los símbolos gobernados, hayan cambiado o no. `.prdm/symbol-cache.json` (gitignored, puramente derivado, seguro de borrar) guarda `{ "<path>#<símbolo|''>": { fileHash, blockHash } }`. En cada resolución: se lee el archivo (ya es obligatorio) y se calcula el sha256 del contenido completo; si coincide con `fileHash` cacheado, se reusa `blockHash` sin invocar al extractor; si no, se extrae, hashea y actualiza la entrada. Se carga una sola vez por `prdm sync`/`refresh` (en `Engine.collect()`, compartida entre todos los blueprints) y se persiste solo desde `doRefresh` — nunca desde `inspect()`, que debe seguir siendo de solo lectura (WO-023 finding 9).

### Comparación de hashes entre extractores

`packages/core/tests/unit/symbol-extractor-comparison.test.ts` corre ambos extractores sobre un corpus de snippets representativos (funciones, clases, arrow functions, overloads, decoradores Python, interfaces/tipos/enums, símbolo ausente) y reporta las coincidencias y divergencias como documentación ejecutable — incluida la del template literal arriba y la de seguridad abajo — no bloquea nada, es la prueba que PRD-003 pide para justificar el reemplazo.

### Dogfooding con gobierno a nivel de símbolo

Esta misma SDD gobierna `packages/core/src/sync/code-refs.ts#resolveGoverned`, como demostración real de `impacts_paths` con sufijo `#símbolo` resuelto por Tree-sitter y sincronizado con 0 drift — el primer uso de symbol-level governance en este repo.

## Seguridad

- `tree-sitter-wasms` y `web-tree-sitter` son dependencias de `@prdm/core` con versión exacta (ADR-003); no se cargan `.wasm` desde una ruta controlada por el contenido de un documento.
- **Hallazgo empírico:** parsear contenido adversarial (llaves sin cerrar en cantidad) es rápido, pero ejecutar la `Query` sobre el árbol con recuperación de errores que resulta puede tardar segundos (medido: ~4s sobre un árbol de 50.000 nodos), porque `Query.matches` no tiene límite propio de tiempo. `TreeSitterSymbolExtractor.extract` acota parseo y query a un mismo plazo (500 ms, el mismo presupuesto que ya usaba el test de la heurística) vía `progressCallback`; superado el plazo, se cancela y se reporta como símbolo no encontrado en vez de bloquear `prdm sync` o el hook post-commit. Se mantiene además el límite de tamaño de lectura ya existente en `safe-fs.ts` como cota superior.
- `symbol-cache.json` es un archivo derivado, sin secretos ni contenido ejecutable; un archivo corrupto se descarta (recalcula) sin abortar `prdm sync`.

## Tareas

- [ ] SymbolExtractor y LegacySymbolExtractor: mover la heurística actual detrás de la interfaz sin cambiar ningún test existente
- [ ] TreeSitterSymbolExtractor con carga perezosa de grammars, preferencia top-level por AST y overloads/decoradores por estructura
- [ ] Cablear el extractor por defecto en resolveGoverned con fallback automático a Legacy por extensión
- [ ] Caché de símbolos por hash de archivo en .prdm/symbol-cache.json, agnóstica al extractor
- [ ] Comparación de hashes entre extractores como test ejecutable y documentación del plan de re-baseline para símbolos futuros
- [ ] Dogfooding: esta SDD gobierna un símbolo real (code-refs.ts#resolveGoverned) sincronizado con 0 drift, y cierre de PRD-003 con prdm close
