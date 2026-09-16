---
id: "FB-006"
type: "FB"
title: "Rediseño del frontend de Centurion Factory con datos mock, iterado en canvas"
status: "new"
created_at: "2026-09-15"
source: "chat"
informs: ["PRD-006"]
---

## Feedback

## Feedback

El usuario pide un PRD y un frontend nuevo para Centurion Factory, **solo diseño y sin backend**:

> "CENTURION FACTORY — PRD + Frontend (solo diseño, sin backend). [...] Navegación intuitiva, dashboard, 5-7 pantallas sobre los top features. Datos mock realistas (10-20+ registros/entidad, con estados: activo, error, loading, vacío). Interactividad sin backend: navegación, filtros, búsqueda, sorting, modales. Copy desde la perspectiva del usuario: voz activa, sentence case, el botón 'Guardar' produce un toast 'Guardado'. [...] Motion: UN momento orquestado. Quality floor: responsive hasta mobile (375px), focus visible por teclado, prefers-reduced-motion respetado, contraste WCAG AA, paleta armónica. [...] Output: PRD, app React ejecutable y hermosa, CLAUDE.md con los design tokens (para reusar en el PRD de backend)."

El brief pedía anclar el diseño en el rubro, que el usuario había descrito como MES, control de producción o logística. La investigación (docs de `centurionhq/core`, este repo y el grafo por MCP) mostró que Centurion Factory es una **fábrica de software**, no una planta de manufactura.

Decisiones tomadas en la conversación:

- **Subject:** se rediseña el producto real: feature tree, documentos colaborativos con agente, work orders, trazabilidad y drift. La metáfora de fábrica es el ancla visual: estaciones de la línea, andon para el drift, cianotipo para los blueprints.
- **Alcance:** un front hermoso con datos mock, sin conectar nada. "Si queda aprobado, en otro PRD se enchufa."
- **Ubicación:** dentro de prdmanager, con el stack del repo (React 19.3.0, Vite 8.3.0, react-router 8.3.1, CSS Modules y tokens; sin Tailwind), en un paquete aislado fuera de los workspaces.
- **Gobernanza:** "El PRD y los WO se tienen que hacer usando prdmanager."
- **Proceso de diseño:** "Usar canvas para ir iterando." Primero direcciones y pantallas en un canvas de diseño; el código React implementa el canvas aprobado.
