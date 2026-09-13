#!/usr/bin/env bash
# Launches the official neo4j-mcp over stdio with credentials loaded from the project .env (keeps secrets out of .mcp.json).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a
# shellcheck disable=SC1091
. "${ROOT}/.env"
set +a
export NEO4J_MCP_URI="${NEO4J_URI}"
export NEO4J_MCP_USERNAME="${NEO4J_USERNAME}"
export NEO4J_MCP_PASSWORD="${NEO4J_PASSWORD}"
export NEO4J_MCP_DATABASE="${NEO4J_DATABASE:-neo4j}"
export NEO4J_MCP_READ_ONLY="${NEO4J_MCP_READ_ONLY:-true}"
export NEO4J_MCP_TELEMETRY=false
export NEO4J_MCP_LOG_LEVEL="${NEO4J_MCP_LOG_LEVEL:-warn}"
exec "${HOME}/.local/bin/neo4j-mcp"
