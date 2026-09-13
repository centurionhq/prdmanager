---
id: ADR-005
type: ADR
title: "Runtime Node 24 LTS para todo el monorepo"
status: active
architects: ["PRD-005"]
impacts_paths: [".nvm[r]c", "package.json", "package-lock.json", "packages/*/package.json", "tsconfig.base.json", "packages/*/tsconfig*.json", "packages/web/tests/**", ".github/workflows/prdm-sync.yml", "README.md"]
created_at: 2026-09-13
tags: ["architecture-decision", "runtime", "node"]
---

## Contexto

El repo está fijado a Node 20.20.2 (ADR-004 descartó jsdom 28+ por exigir Node 22). Node 20 salió de mantenimiento el 2026-04-30 y ADR-004 dejó como disparador de revisión "la próxima feature que necesite subir Node". PRD-005 lo es: sus dependencias centrales exigen Node ≥22 (verificado con `npm view` el 2026-09-13).

| Paquete | Versión | `engines.node` |
|---|---|---|
| @hocuspocus/server | 4.7.0 | `>=22` |
| openai | 7.15.0 | `>=22.0.0` |
| react-router | 8.3.1 | `>=22.22.0` |
| jsdom | 30.0.1 | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |

## Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| Node 22 (Jod, maintenance) | Cumple los mínimos | Sale de soporte en 2027-04; habría que volver a migrar pronto |
| **Node 24.21.0 (Krypton, Active LTS)** | LTS vigente hasta 2028-04; cumple todos los mínimos | Actualizar CI, jsdom y posibles ajustes de tests |
| Node 26 (Current) | Lo más nuevo | No es LTS |

## Decisión

Node **24.21.0** en `.nvmrc`; `engines.node` `>=24` en el `package.json` raíz y en cada paquete (incluidos los paquetes nuevos de PRD-005 al crearse); `@types/node` **24.13.4** (la última 24.x; 26.x describe APIs que Node 24 no tiene); jsdom de 27.4.0 a **30.0.1**; `actions/setup-node` lee `.nvmrc`. En la máquina de desarrollo se instala con **nvm v0.40.7 a nivel usuario**, nunca con `sudo`.

`.nvmrc` figura en `impacts_paths` como `.nvm[r]c`: un literal que todavía no existe resuelve con hash nulo y sync lo marca `missing` (bloqueante), mientras que un patrón dinámico sin coincidencias solo emite un aviso. El patrón matchea exactamente `.nvmrc` en fast-glob y picomatch.

## Consecuencias

- Queda superada la restricción de Node 20 de ADR-004 (sus otras decisiones siguen vigentes).
- Todo desarrollador necesita Node 24; el README lo documenta.
- Habilita el stack de ADR-006.
- Si Node 24 exigiera cambios en código fuente, no se hacen con estos WOs: se agregan como tarea del blueprint que gobierna ese `src`.

## Tareas

- [ ] Fijar Node 24 LTS sin cambios de código fuente: .nvmrc con 24.21.0, engines.node ">=24" en el package.json raíz y en el de cada paquete, @types/node 24.13.4 y ajustes de tsconfig si hicieran falta, con build, typecheck y tests verdes en Node 24
- [ ] Subir jsdom de 27.4.0 a 30.0.1 en packages/web y ajustar los tests de cliente que fallen
- [ ] CI en .github/workflows/prdm-sync.yml con actions/setup-node leyendo .nvmrc y verificación verde de build, typecheck, test:unit y sync --check en Node 24
- [ ] README con el requisito de Node 24 instalado a nivel usuario con nvm
