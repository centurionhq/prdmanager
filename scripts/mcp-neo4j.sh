#!/usr/bin/env bash
# Launches the official neo4j-mcp over stdio in read-only mode with credentials from the project .env (kept out of .mcp.json).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Parse KEY=VALUE lines without executing .env as shell code.
read_env() {
  local key="$1" line value=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == "$key="* ]] && value="${line#"$key="}"
  done < "${ROOT}/.env"
  value="${value%\"}"; value="${value#\"}"
  printf '%s' "$value"
}

NEO4J_MCP_URI="$(read_env NEO4J_URI)"
NEO4J_MCP_USERNAME="$(read_env NEO4J_USERNAME)"
NEO4J_MCP_PASSWORD="$(read_env NEO4J_PASSWORD)"
NEO4J_MCP_DATABASE="$(read_env NEO4J_DATABASE)"
export NEO4J_MCP_URI="${NEO4J_MCP_URI:-neo4j://127.0.0.1:7687}"
export NEO4J_MCP_USERNAME="${NEO4J_MCP_USERNAME:-neo4j}"
export NEO4J_MCP_PASSWORD
export NEO4J_MCP_DATABASE="${NEO4J_MCP_DATABASE:-neo4j}"
# The graph is a derived index rebuilt from docs; manual writes would be lost, so write access is never exposed here.
export NEO4J_MCP_READ_ONLY=true
export NEO4J_MCP_TELEMETRY=false
export NEO4J_MCP_LOG_LEVEL=warn
exec "${HOME}/.local/bin/neo4j-mcp"
