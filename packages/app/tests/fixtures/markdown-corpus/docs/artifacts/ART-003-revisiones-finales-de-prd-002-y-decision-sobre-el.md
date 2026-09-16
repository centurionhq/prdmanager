---
source: "doc"
provides_context_for: ["PRD-002"]
id: "ART-003"
type: "ART"
title: "Revisiones finales de PRD-002 y decisión sobre el criterio de éxito"
created_at: "2026-09-13"
---

## Contenido

Resumen de las revisiones de arquitectura, correctitud y seguridad sobre la implementación de PRD-002 (2026-09-13) y decisiones de cierre.

- Seguridad: un journal plantado en un repositorio clonado podía reescribir archivos arbitrarios; ahora los journals se firman con HMAC por usuario y solo tocan documentos. Se cerraron cuatro bypasses de la política de Refs en CI, el uso de npx sin --no-install, la inyección de campos de frontmatter, la ruptura de fences en prompts y la desactivación del guard de Neo4j local desde .env.
- Correctitud: lock con exclusión mutua real (prueba de estrés multiproceso), rollback que no borra archivos ajenos, borradores que detectan ediciones concurrentes por hash de bytes, proyectos en subdirectorios del repositorio, hooks relativos al worktree, reset con verificación de huella y lecturas que recuperan journals pendientes.
- Arquitectura: el core queda headless; los acks de diseño y el cierre son exclusivos de la CLI; ADR-001 incorpora una tarea de mantenimiento para que su código gobernado respete la política de Refs.
- Analizador full-text: node_text_v2 usa el analizador por defecto de Neo4j (standard-no-stop-words), verificado por el test del modelo de grafo; la migración v2 no se modifica para no invalidar su checksum.
- Criterio de éxito (PRD-002 §5): la iteración Tree-sitter se realizará como PRD-003 en un proyecto creado con prdm init. PRD-002 permanece approved hasta entonces; WO-012 a WO-025 terminados con 0 drift y el test end-to-end de dos proyectos son condición necesaria, no suficiente.
