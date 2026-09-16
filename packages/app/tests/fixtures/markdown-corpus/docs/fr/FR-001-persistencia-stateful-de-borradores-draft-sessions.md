---
id: "FR-001"
type: "FR"
title: "Persistencia stateful de borradores (draft sessions) en @prdm/core"
status: "approved"
created_at: "2026-09-13"
evolves_from: ["PRD-002"]
justified_by: ["FB-003"]
---

## Descripción

## 1. Problema a Resolver

Actualmente, las sesiones de autoría (`DraftSession`) viven exclusivamente en la memoria RAM del servidor MCP o de la CLI. Si el proceso se interrumpe (cierre de terminal, crash del asistente, reinicio del servidor), el borrador del documento se pierde irremediablemente. Esto obliga al usuario a comenzar la redacción desde cero, generando fricción y pérdida de contexto valioso.

## 2. Solución Propuesta

Trasladar la responsabilidad de la persistencia de los borradores desde la capa de transporte (MCP/RAM) hacia el núcleo de la plataforma (`@prdm/core`). El motor debe implementar un almacenamiento local que dote a los borradores de durabilidad, garantizando que el trabajo intermedio sobreviva a cualquier fallo del entorno de ejecución.

## 3. Requisitos Funcionales

- **Almacenamiento local:** el `DraftStore` persiste los estados parciales en `.prdm/drafts/` del proyecto activo (gitignored), a través de las mismas escrituras atómicas del engine (temp + fsync + rename), no en RAM.
- **Transporte sin estado:** las tools MCP de autoría operan sin mantener estado propio; cada llamada delega en `AuthoringService`, que lee y actualiza el almacenamiento persistente.
- **Recuperación de sesión:** al inicializar el servidor MCP o la CLI, `DraftStore` sondea `.prdm/drafts/`; los borradores huérfanos (no expirados) se listan vía `list_drafts` para que el asistente ofrezca retomarlos o descartarlos.
- **Guardado incremental:** `draft_artifact` puede actualizar un borrador existente por `draft_id` sin exigir la validación completa hasta el `commit_artifact` final.
- **Limpieza garantizada:** al confirmar un `commit_artifact` exitoso (escritura en `docs/` y snapshot en Neo4j), el estado persistido del borrador se elimina de forma atómica.

## 4. Criterios de Éxito

1. Matar el proceso del servidor MCP (`kill -9`) a mitad de la redacción de un SDD.
2. Reiniciar el servidor MCP.
3. El asistente conversacional recupera la última versión del borrador sin pérdida de datos y puede continuar hasta su validación y `commit_artifact` final.

## Origen

- FB-003
