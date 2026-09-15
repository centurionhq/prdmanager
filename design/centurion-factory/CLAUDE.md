# Centurion Factory: design package

This package holds the Centurion Factory frontend redesign, built with **mock data only**.

- **Governance:** PRD-006, ADR-007 and SDD-011, all in the prdmanager graph.
- **Isolation:** it is a standalone npm package **outside** the root workspaces, so it never touches governed root files.
- **Future:** a later PRD will port it to `packages/app` and wire it to the real API.
- **Visual truth:** the approved canvas in `canvas/`. When in doubt about a size, color or piece of copy, the artboard wins.

## Commands

Run everything from `design/centurion-factory` with Node 24 (`nvm use 24`).

| Command | What it does |
|---|---|
| `npm install` | Installs this package only. The root lockfile stays untouched. |
| `npm run dev` | Vite dev server |
| `npm test` | Vitest + jsdom (unit and interaction tests) |
| `npm run typecheck` | `tsc --noEmit`. Run it **separately** from the tests; both must pass. |
| `npm run build` | Production build into `dist/` |
| `npm run screenshots` | Playwright captures every route at 1440 and 375 px into `screenshots/` |

**Demo states:** add `?estado=cargando`, `?estado=vacio` or `?estado=error` to any screen. Without the parameter, lists simulate about 400 ms of latency with a skeleton.

**Demo login:** `ana.rios@centurionhq.com` / `centurion`. The SSO flow redirects any `@centurionhq.com` address.

## Rules that are not negotiable

1. **Never hardcode hex (or `rgb()`) outside `src/styles/tokens.css`. Always use `var(--token)`.** `tests/no-hardcoded-hex.test.ts` enforces this. If you need a color that doesn't exist, add a token and a contrast test. Don't write a literal.
2. **Andon yellow is only for drift or a line stop.** It is never text on a light background; on light, use `--andon-texto` next to an andon dot.
3. **Monospace only for literal identifiers:** `WO-143`, SHAs, paths, `agent:claude`, branches, tokens, and Markdown source. Never for labels.
4. **One orchestrated motion moment:** the Planta load reveal. There are no other entrance animations, and everything respects `prefers-reduced-motion`.
5. **Sentence case** everywhere, and no uppercase eyebrows. Spanish copy in active voice ("Tomar orden" → toast "Orden tomada"). Errors say what happened and how to fix it.
6. **Quality floor:** responsive down to 375 px, visible keyboard focus (`--focus-ring`), WCAG AA contrast (tested in `tests/tokens.test.ts`), and hit targets of 44 px on mobile.
7. **No emoji, no arrows in buttons, no decorative gradients**, and no identical rounded cards with the same shadow.

## Tokens

### Product colors

| Token | Hex | Use |
|---|---|---|
| `--grafito` | `#17191C` | Main text; background of the line band |
| `--acero` | `#E9ECEB` | App background |
| `--cianotipo` | `#1F4FA0` | Primary actions, links, blueprint ids |
| `--andon` | `#F5C400` | Drift or line stop only |
| `--senal` | `#1E7F4F` | OK, synced, done — fills and marks only, not text on light backgrounds |
| `--senal-texto` | `#19703F` | Green **text** on acero, superficie or diff-agregado (`--senal` itself is 4.20:1 on acero and fails AA) |
| `--paro` | `#B8322A` | Error, blocking, destructive |

### Derived colors

| Token | Hex | Use |
|---|---|---|
| `--superficie` | `#FBFCFB` | Inputs, panels, selected rows |
| `--regla` | `#C9CFCD` | Borders and main rules |
| `--regla-fila` | `#DDE1DF` | Row separators, skeleton |
| `--relleno` | `#F1F3F2` | Hover, segmented backgrounds |
| `--texto-secundario` | `#33383D` | Secondary body text |
| `--apagado` | `#565D63` | Muted text, labels |
| `--cianotipo-hover` | `#173C7A` | Hover on links and primary buttons |
| `--andon-texto` | `#7A5A00` | Warning text on light backgrounds |
| `--seleccion` | `#D5E0F1` | Text selection |
| `--diff-quitado` / `--diff-agregado` | `#F6E3E1` / `#E1F0E8` | Proposal diffs, accepted lines |
| `--blanco` | `#FFFFFF` | Text on cianotipo or grafito |

### Inside the line band only

`--linea-regla` `#2E3338` · `--linea-apagado` `#8E979F` · `--linea-texto` `#C4CAD0` · `--linea-hecho` `#6FCF9A` · `--linea-pendiente` `#3A4046` · `--linea-tinte-andon`

### Elevation

`--sombra-overlay` for modal, drawer and toast only. `--scrim` behind modals.

### Type

| Token | Value |
|---|---|
| `--font-sans` | **Archivo Variable**, self-hosted (ADR-007), with the `wdth` axis. `--stretch-wide` 112 % for titles and KPIs, `--stretch-display` 125 % for the wordmark. |
| `--font-mono` | **IBM Plex Mono** 400/500, for identifiers only |
| `--text-xs` … `--text-2xl` | 12 · 14 · 16 · 20 · 28 · 44 px |
| Weights | 400 body, 600 emphasis and active nav, 700 section titles, 800 page titles |
| Figures | `.num` gives tabular figures in tables and KPIs |

### Spacing scale (4 px base)

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-6` 24 · `--space-8` 32 · `--space-12` 48

### Shape and layout

| Token | Value |
|---|---|
| `--radius-plate` | 2 px: buttons, badges, panels |
| `--radius-input` | 4 px: inputs |
| `--rule` / `--rule-row` | 1 px lines |
| `--sidebar-width` | 224 px |
| `--bottom-bar-height` | 64 px |
| `--control-height` | 40 px |
| `--hit-target` | 44 px |
| Mobile breakpoint | 767 px. Tables stack below 640 px. |

## Component conventions

- **Structure:** one folder per component with `Name.tsx` and `Name.module.css`, re-exported from `src/components/index.ts`. CSS Modules reference tokens only.
- **Screens:** `src/features/<area>/<Name>Page.tsx`, wired in `src/router.tsx` with a `handle.title` that becomes the document title. Screen-only subcomponents stay in the feature folder.
- **Shared UI:** `Button` (primary · secondary · destructive · ghost), `StatusBadge` (workflow · workOrder · feature; a surface plate with an 8 px square, filled for active and hollow for pending/draft), `IdTag`, `Severity`, `Skeleton`, `EmptyState`, `ErrorState`, `DataTable` (sortable with `aria-sort`, stacks under 640 px), `FilterChips` (radiogroup), `SearchField`, `Modal` and `Drawer` (native dialog, Esc, focus return), `useToast` (`aria-live`, 4 s), `PageHeader` (the only h1 on a page).
- **Data:** import from `src/data`, whose types mirror `@prdm/core` and `@prdm/contracts` without importing them. Mutations are local React state seeded from the mocks; the mock arrays are never mutated.
- **Lists:** use `useDemoState()` for cargando / vacío / error / listo, and `src/lib/filter-sort` for search, filters and stable sort.
- **Tests:** render the real routes with `createMemoryRouter(routes, { initialEntries })` and assert by role and accessible name.
- **Hierarchy:** a full-bleed band (the line), then flat tables with rules, then elevated overlays. Boldness lives only in the Planta line.

## Governance

- **Commits:** every change here is governed by SDD-011 (and the manifests also by ADR-007). Make one work order per commit, using an explicit pathspec and the `Refs: WO-xxx` trailer.
- **New work:** add it to SDD-011's `## Tareas` and generate work orders through prdmanager. Don't commit untracked changes.
