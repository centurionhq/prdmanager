#!/usr/bin/env bash
# Readable demo of PRD-002 §5's two-project isolation story (WO-021, plan "golden-scribbling-zebra" item 5):
#   1. `prdm init` scaffolds two independent projects.
#   5. Documents sharing the exact same ids (FB-001/PRD-001) live in each project's own graph partition, and
#      `prdm project list` / `prdm search` never leak one project's content into the other.
#
# Usage:
#   NEO4J_URI=neo4j://127.0.0.1:7688 NEO4J_PASSWORD=*** ./demo-two-projects.sh
#
# Reads every Neo4j setting from the environment; never hardcodes a secret. Requires a prior `npm run build`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CLI_DIST="$REPO_ROOT/packages/cli/dist/index.js"

if [ ! -f "$CLI_DIST" ]; then
  echo "error: $CLI_DIST not found; run \"npm run build\" at the repo root first" >&2
  exit 1
fi

: "${NEO4J_URI:=neo4j://127.0.0.1:7688}"
: "${NEO4J_USERNAME:=neo4j}"
: "${NEO4J_DATABASE:=neo4j}"
if [ -z "${NEO4J_PASSWORD:-}" ]; then
  echo "error: NEO4J_PASSWORD must be set in the environment (never hardcode it here)" >&2
  exit 1
fi
export NEO4J_URI NEO4J_USERNAME NEO4J_DATABASE NEO4J_PASSWORD

prdm() { node "$CLI_DIST" "$@"; }

DIR_A="$(mktemp -d "${TMPDIR:-/tmp}/prdm-demo-a.XXXXXX")"
DIR_B="$(mktemp -d "${TMPDIR:-/tmp}/prdm-demo-b.XXXXXX")"
PROJECT_ID_A=""
PROJECT_ID_B=""

cleanup() {
  echo
  echo "== cleanup =="
  [ -n "$PROJECT_ID_A" ] && prdm project remove "$PROJECT_ID_A" --yes 2>/dev/null || true
  [ -n "$PROJECT_ID_B" ] && prdm project remove "$PROJECT_ID_B" --yes 2>/dev/null || true
  rm -rf "$DIR_A" "$DIR_B"
}
trap cleanup EXIT

echo "== step 0: apply graph schema migrations (idempotent) =="
prdm db migrate

echo
echo "== step 1: init two independent projects =="
git -C "$DIR_A" init -q -b main
prdm init "$DIR_A" --name demo-a
PROJECT_ID_A="$(grep -m1 '^  id:' "$DIR_A/.prdm.yaml" | awk '{print $2}')"

git -C "$DIR_B" init -q -b main
prdm init "$DIR_B" --name demo-b
PROJECT_ID_B="$(grep -m1 '^  id:' "$DIR_B/.prdm.yaml" | awk '{print $2}')"

echo "project A: $PROJECT_ID_A ($DIR_A)"
echo "project B: $PROJECT_ID_B ($DIR_B)"

echo
echo "== step 5: write documents with the SAME ids (FB-001/PRD-001) but distinct content in each project =="
mkdir -p "$DIR_A/docs/feedback" "$DIR_A/docs/prd"
cat > "$DIR_A/docs/feedback/FB-001-alpha.md" <<'DOC'
---
id: FB-001
type: FB
title: "Feedback Alpha"
root: true
---
Contenido exclusivo alpha-only-marker.
DOC
cat > "$DIR_A/docs/prd/PRD-001-alpha.md" <<'DOC'
---
id: PRD-001
type: PRD
title: "Graph Engine Alpha"
status: approved
justified_by: ["FB-001"]
---
Producto alpha-only-marker: motor de grafos con deteccion de desincronizacion.
DOC

mkdir -p "$DIR_B/docs/feedback" "$DIR_B/docs/prd"
cat > "$DIR_B/docs/feedback/FB-001-beta.md" <<'DOC'
---
id: FB-001
type: FB
title: "Feedback Beta"
root: true
---
Contenido exclusivo beta-only-marker.
DOC
cat > "$DIR_B/docs/prd/PRD-001-beta.md" <<'DOC'
---
id: PRD-001
type: PRD
title: "Graph Engine Beta"
status: approved
justified_by: ["FB-001"]
---
Iniciativa beta-only-marker centrada en reportes financieros.
DOC

(cd "$DIR_A" && prdm sync)
(cd "$DIR_B" && prdm sync)

echo
echo "== prdm project list (both registered on the same shared instance, each with its own root) =="
(cd "$DIR_A" && prdm project list)

echo
echo "== isolation check: A's own search results must never surface B's title, and vice versa =="
echo "-- prdm search alpha-only-marker (from A) --"
RESULT_A="$(cd "$DIR_A" && prdm search alpha-only-marker)"
echo "$RESULT_A"
if echo "$RESULT_A" | grep -q "Beta"; then
  echo "ISOLATION VIOLATION: project A's search leaked project B's content" >&2
  exit 1
fi

echo "-- prdm search beta-only-marker (from B) --"
RESULT_B="$(cd "$DIR_B" && prdm search beta-only-marker)"
echo "$RESULT_B"
if echo "$RESULT_B" | grep -q "Alpha"; then
  echo "ISOLATION VIOLATION: project B's search leaked project A's content" >&2
  exit 1
fi
echo "ok: no cross-project leakage"

echo
echo "== remove project B; only A (and whatever pre-existed) remains =="
(cd "$DIR_A" && prdm project remove "$PROJECT_ID_B" --yes)
PROJECT_ID_B=""
(cd "$DIR_A" && prdm project list)

echo
echo "demo complete: two projects with colliding document ids stayed fully isolated."
