---
id: "FB-003"
type: "FB"
title: "Los borradores de autoría se pierden si el servidor MCP se reinicia"
status: "new"
created_at: "2026-09-13"
source: "chat"
informs: ["PRD-002","FR-001"]
---

## Feedback

Los borradores de autoría (DraftSession) viven solo en RAM del servidor MCP o de la CLI. Si el proceso se interrumpe (crash, reinicio, cierre de terminal) el borrador se pierde por completo y hay que redactar de nuevo. Se pide mover la persistencia de los borradores a @prdm/core (almacenamiento local en .prdm/drafts/, escrituras atómicas), dejar el transporte MCP sin estado propio, y permitir recuperar sesiones huérfanas al reiniciar el servidor.
