---
status: "proposed"
evolves_from: ["PRD-002"]
justified_by: ["ART-003"]
tags: ["tree-sitter","parser","dogfooding"]
id: "PRD-003"
type: "PRD"
title: "Parser de símbolos con Tree-sitter validado de punta a punta con prdm init"
created_at: "2026-09-13"
---

## 1. Visión

Reemplazar la extracción heurística de símbolos (`archivo#símbolo`) por Tree-sitter y realizar la iteración completa en un proyecto creado con `prdm init`, usando exclusivamente autoría conversacional por MCP, hasta cerrarla con 0 issues de drift. Cumplir este PRD valida el criterio de éxito §5 de PRD-002.

## 2. Alcance

- Interfaz `SymbolExtractor` en @prdm/core con la implementación actual y una basada en web-tree-sitter (WASM, sin bindings nativos).
- Comparación de hashes entre extractores y plan de re-baseline versionado para evitar drift masivo.
- Caché de hashes por blob de git para mantener rápido el hook post-commit.

## 3. Criterio de éxito

La feature se diseña (SDD), planifica (WOs), implementa con commits `Refs:` y cierra con `prdm close --ack` en un proyecto inicializado con `prdm init`, con `prdm sync --check` en 0 issues.
