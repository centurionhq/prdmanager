---
id: "WO-309"
type: "WO"
title: "Revisión: editor que escapa caracteres Markdown literales y marcadores de bloque al serializar, soporta escapes con barra invertida y hrefs con paréntesis, con tests de ida y vuelta"
status: "pending"
created_at: "2026-09-15"
implements: ["SDD-011"]
impacts_paths: ["design/centurion-factory/src/**","design/centurion-factory/tests/**","design/centurion-factory/scripts/**","design/centurion-factory/canvas/**","design/centurion-factory/CLAUDE.m[d]"]
source_task: "3f76350ec1ee0775"
tags: ["design","frontend","mock","canvas","accessibility"]
---

## Objetivo
Revisión: editor que escapa caracteres Markdown literales y marcadores de bloque al serializar, soporta escapes con barra invertida y hrefs con paréntesis, con tests de ida y vuelta

## Contexto
SDD-011 — Frontend de diseño de Centurion Factory: tokens, shell, pantallas y datos mock; features: PRD-006

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-011
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-309`
