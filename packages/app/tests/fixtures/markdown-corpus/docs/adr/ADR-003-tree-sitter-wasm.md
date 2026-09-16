---
id: ADR-003
type: ADR
title: "Runtime y grammars WASM para Tree-sitter"
status: active
architects: ["PRD-003"]
impacts_paths: ["packages/core/package.json", ".gitignore"]
created_at: 2026-09-13
tags: ["architecture-decision", "tree-sitter", "wasm", "parser"]
---

## Contexto

PRD-003 pide reemplazar la extracción heurística de símbolos (`sync/code-refs.ts`) por Tree-sitter, sin bindings nativos (para no depender de compilación por plataforma) y eligiendo un paquete que también sirva a una futura UI (pedido explícito del usuario: el mismo runtime debe poder embeberse en un navegador).

## Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| Bindings nativos (`tree-sitter-typescript`, etc., `node-gyp`) | Rápidos, oficiales | Requieren compilación por plataforma; PRD-003 los excluye explícitamente |
| `@vscode/tree-sitter-wasm` 0.3.1 | Runtime y grammars compilados juntos por el mismo build (Microsoft), sin riesgo de desajuste de ABI | Paquete específico de VS Code, no el nombre canónico que una UI web usaría directamente; solo 4 lenguajes (TS/TSX/JS/Python) sin más margen |
| `web-tree-sitter@0.27.0` (última) + `tree-sitter-wasms@0.1.13` | `web-tree-sitter` es el runtime oficial del proyecto Tree-sitter, pensado para Node y navegador por igual — el mismo paquete que usaría una UI futura | **Falla en la práctica:** `Language.load()` lanza un error de metadata de dylink; los grammars de `tree-sitter-wasms` 0.1.13 no son compatibles con el ABI de `web-tree-sitter` 0.27.0 (verificado empíricamente) |
| **`web-tree-sitter@0.25.10` + `tree-sitter-wasms@0.1.13`** | Mismo runtime oficial, compatible en la práctica (verificado), 39 grammars ya disponibles (TS, TSX, JS, Python y más para una futura UI sin agregar dependencias) | No es la versión más reciente de `web-tree-sitter`; subir cualquiera de los dos paquetes exige reverificar la compatibilidad |

## Verificación empírica

Con un spike descartable (`npm install web-tree-sitter@0.25.10 tree-sitter-wasms@0.1.13`): `Parser.init()`, `Language.load()` de `tree-sitter-{typescript,tsx,javascript,python}.wasm`, parseo de un snippet por lenguaje, y una `Query` real (`function_declaration`, `class_declaration`, `variable_declarator` con `arrow_function`) capturando nombres y rangos exactos — las cuatro combinaciones funcionan. `web-tree-sitter@0.27.0` con los mismos grammars falla (`getDylinkMetadata`); `web-tree-sitter@0.24.7`/`0.25.0` fallan por incompatibilidades de import ESM/CJS ajenas al ABI.

## Decisión

**`web-tree-sitter` `0.25.10`** (MIT) como runtime + **`tree-sitter-wasms` `0.1.13`** (Unlicense) como fuente de grammars precompilados, como dependencias exactas de `@prdm/core`.

### Carga de assets

Sin paso de bundling ni copia de archivos: `tree-sitter-wasms` no declara `exports` en su `package.json`, así que sus `.wasm` se resuelven en tiempo de ejecución con `import.meta.resolve('tree-sitter-wasms/out/tree-sitter-<lenguaje>.wasm')` (Node 20 lo soporta sin flags; verificado también desde un módulo anidado, no solo desde la raíz), convertido a un path de archivo y pasado a `Language.load()`. `Parser.init()` corre una sola vez por proceso (memoizado).

## Consecuencias

### Positivas
- Mismo paquete (`web-tree-sitter`) que usaría una UI en el navegador el día que exista: sin bindings nativos, sin recompilar.
- 39 grammars ya instalados; agregar un lenguaje nuevo a `resolveGoverned` no requiere una dependencia nueva.
- Con `Query`, la extracción de símbolos usa el AST real en vez de heurísticas de texto (indentación, conteo de llaves, comentarios): rangos exactos, sin los casos límite que la implementación heurística tiene que manejar a mano.

### Negativas
- **Versión fijada por compatibilidad, no por ser la última:** subir `web-tree-sitter` o `tree-sitter-wasms` exige repetir la verificación empírica (cubierta por `packages/core/tests/unit/tree-sitter-extractor.test.ts`, que falla ruidosamente si `Language.load()` deja de funcionar) antes de aceptar la nueva versión.
- `tree-sitter-wasms` agrega ~52 MB a `node_modules` de `@prdm/core` (35 lenguajes que hoy no se usan); aceptable para una herramienta de gobernanza que ya requiere Docker y Neo4j localmente.
- `tree-sitter-wasms` es un paquete de un mantenedor individual (no el proyecto Tree-sitter ni una empresa); el riesgo se mitiga fijando la versión exacta y con el test de compatibilidad.
- **Query sin timeout propio:** se verificó empíricamente que `Query.matches` puede tardar segundos sobre un árbol con recuperación de errores masiva (ver SDD-004 "Seguridad"), aunque el parseo en sí sea rápido; `TreeSitterSymbolExtractor` acota ambos pasos a un mismo plazo.

## Tareas

- [ ] Confirmar en package.json de packages/core las versiones exactas web-tree-sitter 0.25.10 y tree-sitter-wasms 0.1.13, y agregar el cache de símbolos a .gitignore
