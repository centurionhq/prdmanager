---
id: "WO-220"
type: "WO"
title: "Revisión de seguridad #2 (MEDIUM): conectar la revocación en vivo de /collab a los eventos de better-auth de revocación de sesión y cambio de contraseña, para que no dependan solo de la revalidación periódica de 60s como único mecanismo, con test de revocación instantánea por esos dos eventos"
status: "pending"
created_at: "2026-09-14"
implements: ["SDD-008"]
impacts_paths: ["packages/collab/src/**","packages/collab/tests/**","packages/collab/*.json","packages/contracts/src/**","packages/contracts/tests/**","packages/server/src/**","packages/server/tests/**","packages/server/*.json","packages/db/src/**","packages/db/tests/**","packages/db/migrations/**","packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".env.example","README.md"]
source_task: "d1ea756880e79bb7"
tags: ["saas","realtime","yjs","blame","comments","versions"]
---

## Objetivo
Revisión de seguridad #2 (MEDIUM): conectar la revocación en vivo de /collab a los eventos de better-auth de revocación de sesión y cambio de contraseña, para que no dependan solo de la revalidación periódica de 60s como único mecanismo, con test de revocación instantánea por esos dos eventos

## Contexto
SDD-008 — Documentos colaborativos en tiempo real: Yjs, autoría por línea, versiones y comentarios; features: PRD-005

## Criterios de aceptación
- [ ] Implementación realizada dentro del código gobernado por SDD-008
- [ ] Tests que cubren el cambio
- [ ] Commit realizado con el trailer `Refs: WO-220`
