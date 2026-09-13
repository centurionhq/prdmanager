---
id: "WO-205"
type: "WO"
title: "Corregir el E2E de packages/web que busca las filas de work orders por role row (desde WO-071 son role button) y la versión de npm del README (11.19.0 con Node 24), con Playwright verde en Node 24"
status: "pending"
created_at: "2026-09-13"
implements: ["ADR-005"]
impacts_paths: [".nvm[r]c","package.json","package-lock.json","packages/*/package.json","tsconfig.base.json","packages/*/tsconfig*.json","packages/web/tests/**",".github/workflows/prdm-sync.yml","README.md"]
source_task: "70add6c71c78a653"
tags: ["architecture-decision","runtime","node"]
---

## Objetivo
Corregir el E2E de packages/web que busca las filas de work orders por role row (desde WO-071 son role button) y la versión de npm del README (11.19.0 con Node 24), con Playwright verde en Node 24

## Contexto
ADR-005 — Runtime Node 24 LTS para todo el monorepo; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por ADR-005
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-205`
