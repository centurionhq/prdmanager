---
architects: ["PRD-006"]
impacts_paths: ["design/centurion-factory/*.json","design/centurion-factory/*.config.ts","design/centurion-factory/index.htm[l]","design/centurion-factory/src/styles/**","design/centurion-factory/src/main.tsx","design/centurion-factory/tests/setup.ts","design/centurion-factory/tests/isolation.test.ts","design/centurion-factory/tests/fonts.test.ts"]
tags: ["architecture-decision","design","frontend","mock"]
id: "ADR-007"
type: "ADR"
title: "Paquete de diseño aislado: CSS Modules + tokens, fuentes self-hosted, fuera de workspaces"
created_at: "2026-09-15"
---

## Contexto

PRD-006 pide un frontend nuevo de Centurion Factory **solo con datos mock**, que se diseña primero en un canvas con el usuario y se conecta en un PRD posterior. Restricciones:

- El stack tiene que ser el de `packages/app`, para que portar las pantallas aprobadas sea directo.
- No puede tocar archivos raíz gobernados por SDD-006, SDD-009 y SDD-010 (`package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig*.json`). Si los tocara, generaría drift ajeno y un `Refs:` cruzado.
- Tiene que correr sin red, como el resto de las herramientas locales (ADR-004).
- El brief exige una tipografía elegida a propósito, no la pila del sistema.

## Opciones consideradas

| Tema | Opción | Pros | Contras |
|---|---|---|---|
| Ubicación | `packages/factory-design` (workspace) | Hoisting compartido, mismo `tsc -b` | Cambia `package-lock.json` raíz y exige tocar `vitest.config.ts` (coverage) y los scripts raíz, que están gobernados por otros blueprints → **descartada** |
| Ubicación | **`design/centurion-factory`, paquete npm propio fuera de `workspaces`** | Cero archivos raíz tocados; CI y cobertura raíz no lo ven; se borra o se porta sin efectos laterales | `node_modules` propio (duplica React y Vite en disco) |
| Estilos | Tailwind 4.3.3 | Rápido para prototipar | No existe en el repo; portar a `packages/app` obligaría a reescribir clases o a meter Tailwind en la app → **descartado** |
| Estilos | **CSS Modules + `tokens.css` con variables CSS** | Misma convención que `packages/app` y `packages/ui`; los tokens se portan tal cual | Más CSS escrito a mano |
| Tipografía | Pila `system-ui` (ADR-004) | Cero bytes | El brief pide una familia con intención; no transmite el mundo "planta" |
| Tipografía | Google Fonts por CDN | Catálogo amplio | Pedido externo y CSP más laxa (ya descartado en ADR-004) |
| Tipografía | **`@fontsource-variable/archivo` 5.3.0 + `@fontsource/ibm-plex-mono` 5.3.0, self-hosted** | Sin red, versión fijada, eje de ancho (`wdth`) para jerarquía sin sumar familias | Unos cientos de KB de woff2 en el bundle |
| Iconos | **lucide-react 1.46.0** | Trazo consistente, tree-shaking | Una dependencia más |

## Decisión

- **Paquete:** `design/centurion-factory` es un paquete npm independiente, fuera de `workspaces`, con su propio `package-lock.json`.
- **Versiones** fijadas igual que en `packages/app`: React y react-dom 19.3.0, Vite 8.3.0, @vitejs/plugin-react 6.1.1, react-router 8.3.1 (modo data), TypeScript 7.0.2, vitest 4.1.11, @testing-library/react 16.3.3, dom 10.4.1, user-event 14.6.7, jsdom 30.0.1, @playwright/test 1.63.0 (solo capturas) y `@types/react`/`@types/react-dom` 19.3.0. `engines.node` es `>=24` (ADR-005).
- **Estilos:** CSS Modules sobre `src/styles/tokens.css`. Ningún color hex fuera de ese archivo, y un test lo verifica.
- **Tipografía:** Archivo variable para interfaz y titulares, IBM Plex Mono **solo** para identificadores literales (`WO-143`, SHAs, rutas). Es una excepción a la pila de sistema de ADR-004 **acotada a este paquete**. Si PRD-006 se porta a `packages/app`, el PRD de conexión decide si la excepción se extiende.
- **Iconos:** lucide-react 1.46.0.

## Consecuencias

- **Aislamiento:** la CI raíz (`npm run build`, `typecheck`, `test:unit`) no compila ni testea este paquete. Su verificación corre dentro de la carpeta y es parte de los criterios de los WOs.
- **Revisión de la raíz:** cada WO de este blueprint verifica con `git status` que no cambió ningún archivo raíz.
- **Futuro:** conectar el diseño a la API real pertenece a otro PRD. En ese momento el paquete se porta a `packages/app` y se retira.

## Tareas

- [ ] Scaffold del paquete aislado design/centurion-factory: package.json con versiones fijadas de packages/app y engines node>=24, tsconfig, vite.config.ts, vitest.config.ts, index.html y .gitignore (node_modules, dist, screenshots), con smoke test y verificación de que ningún archivo raíz cambió
- [ ] Fuentes self-hosted Archivo variable e IBM Plex Mono importadas desde base.css con pilas de respaldo y font-display swap, sin pedidos de red, con test que lo verifica
