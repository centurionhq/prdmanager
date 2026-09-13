---
id: PRD-001
type: PRD
title: "Product & Context Graph Engine para Asistentes de Código"
status: draft
created_at: 2026-09-12
implements: ["MRD-001"]
tags: ["doc-as-code", "graphrag", "mcp", "ai-assistant", "product-management", "feature-tree", "knowledge-graph"]
---

## 1. Visión General y Objetivo

El objetivo de este proyecto es construir un motor de contexto y ciclo de vida de producto basado en grafos (Product & Context Graph Engine). Este sistema actuará como la "fuente única de verdad" compartida donde tu equipo y los agentes de IA (asistentes de código) colaboran, unificando la gestión de producto, la arquitectura y el código fuente.

Inspirado en ecosistemas complejos de desarrollo colaborativo, el sistema no solo enlazará jerarquías documentales (MRD, PRDs, ADRs), sino que estructurará el producto en un **Feature Tree**, conectará **Blueprints** técnicos con **Work Orders** accionables, y usará el grafo para detectar dependencias rotas y desincronizaciones entre la documentación y el código real en tiempo real [cite: 1].

## 2. Alcance (Scope)

**Dentro del alcance:**
* **Feature Tree & Requerimientos:** Organización de PRDs y Feature Requests en un árbol jerárquico que modela la evolución del producto [cite: 1].
* **Blueprints Técnicos (SDD/ADR):** Planes técnicos que vinculan directamente la arquitectura del sistema a nodos específicos del Feature Tree [cite: 1].
* **Work Orders & MCP:** Transformación de requerimientos en órdenes de trabajo que el asistente de código puede consumir y ejecutar a través de Model Context Protocol (MCP) [cite: 1].
* **Context Artifacts:** Capacidad de adjuntar artefactos externos no estructurados (transcripciones, correos, hilos de Slack) como nodos de contexto en el grafo [cite: 1].
* **Feedback Loop:** Un flujo para convertir feedback de usuarios en nuevos Feature Requests vinculados al grafo [cite: 1].
* **Out-of-sync Detection:** Alertas automáticas impulsadas por el grafo cuando un cambio en el código rompe un Blueprint, o cuando un requerimiento evoluciona y deja código legado desactualizado [cite: 1].

## 3. Casos de Uso Críticos

1. **Gestión de Tareas Integrada (Work Orders via MCP):** Un desarrollador asigna un "Work Order" al asistente de código [cite: 1]. El asistente se conecta vía MCP, lee el ticket, navega el grafo hacia el Blueprint (SDD) y el nodo del Feature Tree (PRD) correspondiente [cite: 1], y genera la implementación exacta respetando el contexto completo.
2. **Detección de Desincronización (Drift Detection):** Un arquitecto actualiza un Blueprint técnico [cite: 1]. Inmediatamente, el Graph Engine marca los Work Orders asociados y el código indexado en GitHub como "fuera de sincronización" (`out_of_sync`) [cite: 1], alertando al equipo y al asistente de IA sobre las refactorizaciones necesarias.
3. **Triaje de Feedback a Feature:** Entra un requerimiento de usuario a través del módulo de Feedback [cite: 1]. Se usa la IA para procesarlo y crear un nodo en el Feature Tree [cite: 1], relacionándolo con transcripciones de llamadas (Artifacts) [cite: 1] para justificar la evolución del producto.

## 4. Requerimientos Funcionales

| Req ID | Componente | Descripción | Criterio de Aceptación |
| :--- | :--- | :--- | :--- |
| **F-01** | **Parser de Ecosistema** | Analizar documentos estructurados (PRD, SDD) y artefactos no estructurados (emails, transcripciones) [cite: 1]. | Los artefactos se asocian correctamente a los requerimientos que justifican. |
| **F-02** | **Feature Tree Mapper** | Interfaz o API que permita visualizar y gestionar requerimientos de producto como un árbol de jerarquías y dependencias [cite: 1]. | Consultas al grafo pueden reconstruir la rama completa de una feature desde su raíz hasta el código. |
| **F-03** | **Sync Monitor** | Motor que monitorea cambios en el repositorio conectado (ej. GitHub) [cite: 1] y los compara con los Blueprints técnicos vigentes [cite: 1]. | Los nodos del grafo adquieren el estado `out_of_sync` cuando sus dependencias cambian [cite: 1]. |
| **F-04** | **Work Order Generator** | Convertir Blueprints en tareas discretas (Work Orders) que se enlazan al código [cite: 1]. | Las tareas pueden ser extraídas y ejecutadas por agentes mediante MCP [cite: 1]. |
| **F-05** | **Feedback Ingestor** | Módulo para capturar feedback de usuarios y estructurarlo en el backlog del grafo [cite: 1]. | El feedback se vincula automáticamente al Feature Tree [cite: 1]. |

## 5. Esquema Ampliado de Nodos y Relaciones

El sistema soportará una estructura viva y altamente conectada:

**Feature Tree & Contexto:**
* `(Feedback) -[:INFORMS]-> (Feature_Node)` [cite: 1]
* `(Artifact: Meeting/Email) -[:PROVIDES_CONTEXT_FOR]-> (Feature_Node)` [cite: 1]
* `(Feature_Node_Hijo) -[:EVOLVES_FROM]-> (Feature_Node_Padre)` [cite: 1]

**Ejecución y Arquitectura:**
* `(Blueprint: SDD/ADR) -[:ARCHITECTS]-> (Feature_Node)` [cite: 1]
* `(Work_Order) -[:IMPLEMENTS]-> (Blueprint)` [cite: 1]
* `(Work_Order) -[:ASSIGNED_TO]-> (Developer | AI_Agent)` [cite: 1]

**Código y Sincronización:**
* `(Code_Change/Commit) -[:RESOLVES]-> (Work_Order)` [cite: 1]
* `(File|Function) -[:GOVERNED_BY {status: 'synced'|'out_of_sync'}]-> (Blueprint)` [cite: 1]

## 6. Métricas de Éxito

1. **Eficiencia Agente-Humano:** Disminución en el tiempo de resolución de Work Orders gracias a la inyección de contexto desde Blueprints y Artifacts [cite: 1].
2. **Integridad del Sistema:** % de código base que está correctamente "sincronizado" con su respectivo Blueprint arquitectónico [cite: 1].
3. **Trazabilidad Completa:** 100% de los PRDs y cambios en código tienen un camino ininterrumpido en el Knowledge Graph que los conecta [cite: 1].
