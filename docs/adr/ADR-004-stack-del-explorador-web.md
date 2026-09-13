---
id: ADR-004
type: ADR
title: "Stack del explorador web: Fastify + Vite + React + Cytoscape"
status: active
architects: ["PRD-004"]
impacts_paths: ["packages/web/package.json", "packages/web/vite.config.ts"]
created_at: 2026-09-13
tags: ["architecture-decision", "web-ui", "frontend", "backend"]
---

## Contexto

PRD-004 pide un explorador local de solo lectura del Feature Tree y del drift, como paquete real del monorepo. Restricciones: Node 20.20.2 (el del repo), TypeScript 7 con `tsc -b`, versiones exactas, cero dependencias innecesarias, y que corra sin red (herramienta local).

## Opciones consideradas

| Tema | Opción | Pros | Contras |
|---|---|---|---|
| Backend | `node:http` plano | Cero dependencias | Ruteo, validación, estáticos y errores a mano |
| Backend | Express 5 | Conocido | Tipado de segunda mano, sin `inject()` para tests |
| Backend | **Fastify 5.12.4** + @fastify/static 10.1.3 | TS de primera, `app.inject()` para tests de integración sin puerto, hooks `onSend` para cabeceras | Una dependencia más |
| Visualización | Mermaid / D3 server-side | Mermaid ya se usa en la CLI | Sin interacción real (seleccionar, pan/zoom, resaltar) |
| Visualización | **Cytoscape.js 3.34.3** | Grafo interactivo en canvas, estilos por datos (`status`, `reviewNeeded`), escala a cientos de nodos | Canvas no es accesible por sí mismo → se exige vista de árbol alternativa |
| Integración React | `react-cytoscapejs` 2.0.0 | Compatible (peers `react>=15`) | Solo envuelve el montaje; refresco con `cy.json()` y estilos se hacen igual con la API directa |
| Integración React | **Hook propio `useCytoscape`** | ~40 líneas, sin dependencia extra | Mantenimiento propio |
| Frontend build | **Vite 8.3.0 + @vitejs/plugin-react 6.1.1 + React 19.3.0** | Estándar actual; requiere Node `^20.19.0 \|\| >=22.12.0` (20.20.2 cumple) | Primer JSX del repo |
| DOM de test | jsdom 30.0.1 / 28.x | Últimas | **Exigen Node 22** — descartadas |
| DOM de test | **jsdom 27.4.0** | Node `^20.19.0` | No es la última |
| E2E | **@playwright/test 1.63.0** | Regla del equipo para E2E; Chromium ya cacheado localmente | Descarga de navegador en CI |
| Tipografía | Google Fonts | Fuentes del design system | Pedido externo en una herramienta local, CSP más laxa → **descartado**; pila `system-ui`/`ui-monospace` |

## Decisión

Fastify 5.12.4, @fastify/static 10.1.3, zod 4.6.3 (ya en el repo), Vite 8.3.0, @vitejs/plugin-react 6.1.1, React/react-dom 19.3.0, cytoscape 3.34.3 con hook propio, @testing-library/react 16.3.3 + dom 10.4.1 + user-event 14.6.7, jsdom 27.4.0, @playwright/test 1.63.0, tipos `@types/react`/`@types/react-dom` 19.3.0 y `@types/cytoscape` 3.31.0. `engines.node` de `packages/web` es `>=20.19.0`.

## Consecuencias

- Subir Vite/jsdom a versiones que exijan Node 22 requiere subir primero el Node del repo.
- `packages/web` no depende de `@prdm/mcp`: ambos son hojas sobre `@prdm/core`.
- Dirección visual (Minimalism/Swiss, oscuro por defecto con claro soportado, tokens semánticos) tomada del design system generado con `ui-ux-pro-max`; drift nunca se comunica solo con color.
- Node 20 alcanza fin de soporte del proyecto Node.js el 2026-04-30; el disparador concreto para revisar esta ADR es "la próxima feature que necesite subir Node" (jsdom 28+/Vite 9+ que exijan Node 22 dejan de ser un problema en ese momento, no antes).

## Tareas

- [ ] Fijar en packages/web/package.json las versiones exactas del stack e instalar, y crear vite.config.ts con plugin React, outDir dist/client y proxy de /api
