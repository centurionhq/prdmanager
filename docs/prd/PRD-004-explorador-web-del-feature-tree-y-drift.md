---
id: "PRD-004"
type: "PRD"
title: "Explorador web del Feature Tree y del drift"
status: "approved"
created_at: "2026-09-13"
evolves_from: ["PRD-002"]
justified_by: ["FB-004"]
tags: ["web-ui", "explorer", "drift", "dogfooding"]
---

## 1. Visión

PRD-002 diseñó `@prdm/core` headless "para habilitar interfaces visuales (Web UI) en el futuro sin perder la agilidad actual de la terminal", y FB-002 registra que el split en npm workspaces se hizo para que una Web UI pueda importar el core. Hoy el Feature Tree, el drift, las métricas y los Work Orders solo se ven por CLI, MCP o Neo4j Browser. Este PRD entrega el primer consumidor visual: un explorador local de solo lectura. Reemplaza la decisión "UI web fuera del MVP" del README.

## 2. Alcance

- Paquete `packages/web`: backend Fastify que envuelve 1:1 `GraphStore`, `Engine.inspect()` y `computeMetrics`, solo `GET`, ligado a `127.0.0.1`.
- Frontend React con canvas Cytoscape del grafo, búsqueda, panel de detalle, lista de Work Orders de solo lectura, banner de drift, y vista de árbol navegable por teclado como alternativa accesible al canvas.
- Drift señalado con color **y** forma/ícono; tema claro y oscuro.
- Tests: unitarios e integración del backend contra Neo4j real, componentes con Testing Library, E2E con Playwright.

**Fuera de alcance:** autoría desde la UI, cambios de estado de WOs, selector multi-proyecto, autenticación, despliegue remoto.

## 3. Criterio de éxito

`npm run web` (backend + bundle construido) muestra el Feature Tree real de este repositorio con el drift resaltado; la respuesta de `GET /api/tree?root=PRD-004` coincide con el `buildForest` que usa `prdm tree PRD-004` internamente (verificado en el dogfooding, no solo a simple vista); el E2E de Playwright pasa localmente; CI (`prdm sync --check` + `check commits --range`) queda verde en cada push; la feature se cierra con `prdm close PRD-004 --ack`.
