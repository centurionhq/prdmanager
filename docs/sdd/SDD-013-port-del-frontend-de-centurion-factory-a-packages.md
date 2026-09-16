---
architects: ["PRD-007"]
impacts_paths: ["packages/app/src/**","packages/app/tests/**","packages/app/*.json","packages/app/*.config.ts","packages/app/index.htm[l]","packages/server/package.json","packages/server/tests/e2e/**","packages/server/tests/learning/**","packages/server/src/spa-html.ts","packages/server/src/security-headers.ts","design/centurion-factory/canvas/**","package.json","package-lock.json","tsconfig.json","tsconfig.test.json","vitest.config.ts",".github/workflows/prdm-sync.yml","README.md"]
tags: ["saas","frontend","design","canvas","e2e"]
id: "SDD-013"
type: "SDD"
title: "Port del frontend de Centurion Factory a packages/app: pantallas, rondas de canvas y capa de datos real"
created_at: "2026-09-15"
---

## Contexto

ADR-008 fijó la estructura, los tokens, la capa de datos y el mapa de rutas del port. SDD-012 provee las rutas nuevas. Este SDD ejecuta la migración pantalla por pantalla, incluidas las que PRD-006 nunca diseñó porque el mock no las necesitaba, y retira las pantallas viejas de `packages/app` al final.

Verificado en el código: `packages/server/tests/e2e/full-journey.spec.ts` depende de nombres accesibles concretos ("Email", "Contraseña", el botón "Ingresar", `.cm-content`, "Nuevo documento", "Tipo de documento", "Comentarios", "Aceptar", "Solicitar revisión", "Publicar") y de las rutas `/o/…/p/…/documents[/:docId]`. El diseño aprobado en PRD-006 usa "Entrar" en vez de "Ingresar" y abre en la pestaña "Vista previa" en vez de directo en Markdown. Un port que cambia esos textos sin tocar el E2E lo rompe a mitad de rama. `design/centurion-factory` corre su propio Vitest fuera del workspace raíz, así que sus tests (tokens, contraste, hex, componentes) no corren en CI hoy: se portan a `packages/app/tests`, donde sí corren.

**Sobre `impacts_paths`:** se re-lista `design/centurion-factory/canvas/**`, que SDD-011 ya gobierna con sus WOs en `done` (mismo patrón de reutilización que en SDD-012), porque las rondas de canvas de este SDD agregan artboards nuevos a ese mismo directorio.

## Diseño

### Rondas de canvas (antes de cualquier pantalla nueva)

**Ronda A — pantallas sin diseño previo.** Con el usuario, extendiendo el canvas aprobado de PRD-006:
- Autenticación y cuenta: reseteo de contraseña, aceptar invitación, paso de verificación en dos pasos (y su enrolamiento), panel de superadmin, perfil (nombre de solo lectura: `/update-user` no está en el allowlist de better-auth), tokens personales, auditoría, miembros de organización.
- Pantalla de revisión previa a publicar: versión N congelada, diff de frontmatter (con `impacts_paths` destacado) y de `## Tareas`, links y comandos agregados, reintento de generación de órdenes.
- Estados de Documento: documento `generated` o `archived` (de solo lectura), scope `readonly` de colaboración, desconexión y reconexión, presencia de otros usuarios, streaming del agente con sus llamadas a herramientas.
- Insignias y avisos: "no verificado por CI", anulación de force-push, error `rate_limited`.
- Vista previa de solo lectura en mobile.

**Ronda B — ajuste a datos reales.** Con el usuario:
- Reglas de estación de la Planta contra features reales (más de seis simultáneas, "esperando primer reporte").
- Token de CI sin campo de rama (la baseline depende de OIDC más la rama por defecto, no de una rama elegida al crear el token).
- Ocultamiento de SSO en login y en Ajustes.
- Bandeja de entrada con ítems `generated` (triaje inmediato) y `collab` (enlaza al documento).
- Un issue de drift sin feature asociada.

Cada ronda se registra como aprobada (con fecha) antes de empezar las pantallas que dependen de ella.

### Implementación

**Shell.** El selector de organización y proyecto lee de la API (reemplaza a `CURRENT_ORG`/`CURRENT_PROJECT` del mock). Cada acción de la interfaz se habilita con `can(subject, action)` de `packages/contracts`, nunca con una condición propia del componente.

**Documento.** Reutiliza `CollabDocumentProvider`, `CollabEditor`, `FrontmatterForm` (sobre `Y.Map('fm')`) y los paneles existentes (Comentarios, Versiones, Validación, Agente), restilados con los tokens nuevos. La pestaña "Vista previa" muestra el `MarkdownPreview` existente en modo solo lectura, sumando `remark-gfm` para que tablas y listas de tareas rendericen, hasta que SDD-014 la reemplace por el editor real.

**Migración de tests.** Los tests de diseño (tokens sin hex, contraste AA, componentes) se portan a `packages/app/tests/unit` y `tests/client`, con las mismas aserciones, para que corran en CI.

**Contrato de nombres accesibles del E2E.** Cada WO de pantalla que cambia un texto que el E2E usa como selector actualiza `full-journey.spec.ts` en el mismo commit. Cambios ya sabidos: el botón de login pasa a "Entrar"; el flujo debe clickear la pestaña "Markdown" antes de buscar `.cm-content`, porque el editor abre en "Vista previa" por defecto.

## Tests

Cada pantalla porta sus tests de interacción existentes (render por rol y nombre accesible, `createMemoryRouter`, `vi.spyOn(client, …)`). El shell tiene un test de enrutamiento que cubre las redirecciones heredadas y el gateo por `can()`. El E2E extendido cubre: login con verificación en dos pasos, Planta con estación real, Árbol con trazabilidad de código real, Documentos, Documento con revisión de publicación, Órdenes con reclamar/completar, Drift con reconocer, Entrada con triaje. Un listener de `securitypolicyviolation` en el E2E falla el test si dispara alguna vez.

## Tareas

- [ ] Canvas ronda A: extender el canvas aprobado con las pantallas sin diseño previo listadas arriba; republicar; registrar la aprobación del usuario
- [ ] Canvas ronda B: ajustar las reglas de estación y las pantallas afectadas por datos reales; republicar; registrar la aprobación del usuario
- [ ] Portar los componentes compartidos (Button, StatusBadge, IdTag, Severity, Skeleton, EmptyState, ErrorState, DataTable, FilterChips, SearchField, Modal, Drawer, Toast, PageHeader, Tabs) con sus tests
- [ ] Capa de datos: `useApiQuery`/`useApiMutation`, manejo global de 401 con `next=` relativo, mapeo de `rate_limited` y `not_found` a copy en español, con tests
- [ ] Módulos de API para cada ruta de SDD-012 en el barrel `client.ts`, con tests
- [ ] Shell y router: selector de organización y proyecto desde la API, títulos por ruta, gateo con `can()`, página 404, redirecciones heredadas, con test de enrutamiento
- [ ] Login (con paso de verificación en dos pasos), reseteo de contraseña, aceptar invitación; actualizar el helper `login()` del E2E
- [ ] Proyectos, sobre `GET .../projects/overview`
- [ ] Planta, sobre `GET P/line-board` y `GET P/metrics`
- [ ] Árbol de features, con trazabilidad de código real (`GET P/code-refs`, `GET P/commits`) y el modal de cierre
- [ ] Documentos (lista y creación); actualizar los pasos del E2E que la usan
- [ ] Documento: encabezado, acciones de flujo, pantalla de revisión de publicación, reintento de generación de órdenes
- [ ] Documento: formulario de frontmatter, pestaña Markdown, presencia, desconexión, solo lectura; actualizar el E2E para clickear "Markdown" antes de `.cm-content`
- [ ] Documento: paneles de comentarios, versiones, validación y agente (streaming SSE)
- [ ] Órdenes de trabajo: filtros, drawer con contexto real, reclamar y completar
- [ ] Drift: reporte oficial, vistas previas, historial, detalle de reporte, reconocer, anulación de force-push
- [ ] Bandeja de entrada: listado, envío, candidatos, triaje
- [ ] Ajustes: miembros de proyecto y de organización, con reenvío de invitación
- [ ] Ajustes: tokens de CI y personales
- [ ] Ajustes: general, perfil, auditoría
- [ ] Panel de superadmin (con verificación en dos pasos)
- [ ] Retirar las rutas, componentes, estilos y tests viejos de `packages/app`; quitar la dependencia de `@prdm/ui`
- [ ] E2E: pasos de estación real en Planta, triaje en Entrada, reclamar en Órdenes; listener de `securitypolicyviolation` que falla el test
- [ ] Gate: correcciones de la auditoría de accesibilidad (axe en Playwright)
- [ ] Gate: correcciones de la revisión de seguridad (hrefs, open redirect de `next=`, XSS en el Markdown renderizado)
- [ ] Gate: correcciones del code review
- [ ] Dogfooding: `prdm link --import` de este repositorio a una instancia SaaS local; comparar Planta, Árbol y Entrada contra `prdm tree` local; los hallazgos quedan como FB nuevos; actualizar el README con la guía de dev de `packages/app` conectado
