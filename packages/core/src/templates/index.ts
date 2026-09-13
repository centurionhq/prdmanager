import type { DocKind } from '../domain/schema.js';

/**
 * Document kinds an author (human or MCP `author_artifact`) can create from a template.
 * `WO` is excluded: per SDD-002 "Ciclo de vida" a work order is only ever created by the generator (`prdm wo generate`).
 */
export type TemplateKind = Exclude<DocKind, 'WO'>;

const MRD_TEMPLATE = `---
id: MRD-?
type: MRD
title: ""
status: draft
justified_by: []
tags: []
---

## Problema

## Mercado

## Oportunidad
`;

const PRD_TEMPLATE = `---
id: PRD-?
type: PRD
title: ""
status: draft
implements: []
justified_by: []
tags: []
---

## Resumen

## Requisitos

## Fuera de alcance
`;

const FR_TEMPLATE = `---
id: FR-?
type: FR
title: ""
status: draft
implements: []
justified_by: []
tags: []
---

## Solicitud

## Contexto
`;

const SDD_TEMPLATE = `---
id: SDD-?
type: SDD
title: ""
status: active
architects: []
impacts_paths: []
tags: []
---

## Contexto

## Arquitectura

## Seguridad

## Tareas

- [ ]
`;

const ADR_TEMPLATE = `---
id: ADR-?
type: ADR
title: ""
status: active
architects: []
impacts_paths: []
tags: []
---

## Contexto

## Decisiones

## Tareas

- [ ]
`;

const FB_TEMPLATE = `---
id: FB-?
type: FB
title: ""
status: new
source: other
informs: []
root: true
tags: []
---

## Feedback
`;

const ART_TEMPLATE = `---
id: ART-?
type: ART
title: ""
status: active
source: other
provides_context_for: []
root: true
tags: []
---

## Contexto
`;

/** One markdown skeleton per authorable kind, keyed by {@link TemplateKind}; consumed by the MCP `prdm://templates/{kind}` resource. */
export const TEMPLATES: Readonly<Record<TemplateKind, string>> = {
  MRD: MRD_TEMPLATE,
  PRD: PRD_TEMPLATE,
  FR: FR_TEMPLATE,
  SDD: SDD_TEMPLATE,
  ADR: ADR_TEMPLATE,
  FB: FB_TEMPLATE,
  ART: ART_TEMPLATE,
};

export function isTemplateKind(kind: DocKind): kind is TemplateKind {
  return kind !== 'WO';
}

/** Returns the markdown skeleton for `kind`; throws for `WO`, which has no author-facing template. */
export function templateFor(kind: TemplateKind): string {
  return TEMPLATES[kind];
}
