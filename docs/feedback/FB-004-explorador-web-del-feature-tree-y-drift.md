---
id: "FB-004"
type: "FB"
title: "Explorador web del Feature Tree y del drift, con expertos y WOs capilares"
status: "new"
created_at: "2026-09-13"
source: "chat"
informs: ["PRD-004"]
---

## Feedback

El usuario pide una UI para iterar sobre el motor. Decisiones tomadas en la conversación:

- **Alcance:** explorador de solo lectura del Feature Tree y del estado de drift. Autoría conversacional y kanban de Work Orders quedan para PRDs futuros.
- **Forma:** directo como paquete real del monorepo (`packages/web`), no prototipo descartable.
- **Stack:** Vite 8.3.0 + React 19.3.0 + Cytoscape.js 3.34.3 en el frontend; Fastify 5.12.4 en el backend. Hook propio de Cytoscape en vez de `react-cytoscapejs`.
- **Forma de trabajo:** el primer plan (el lead construyendo todo solo, 13 WOs gruesos) fue rechazado: "Creo que puede ser algo arriesgado no usar skills y expertos, para algo lo tenemos; en cualquier caso tengamos WO más capilares". Cada fase usa subagentes expertos y skills instaladas con compuertas de revisión, y cada WO es un único commit verificable.
