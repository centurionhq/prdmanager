#!/usr/bin/env bash
# Installs local tooling for managing the Neo4j graph: official neo4j-mcp binary (checksum-verified) and uv (for uvx MCP servers).
set -euo pipefail

NEO4J_MCP_VERSION="1.6.0"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "${BIN_DIR}"

install_neo4j_mcp() {
  if command -v neo4j-mcp >/dev/null 2>&1 && neo4j-mcp --version 2>/dev/null | grep -q "${NEO4J_MCP_VERSION}"; then
    echo "neo4j-mcp ${NEO4J_MCP_VERSION} already installed"
    return
  fi
  local os arch asset tmp
  os="$(uname -s)"
  arch="$(uname -m)"
  asset="neo4j-mcp_${os}_${arch}.tar.gz"
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp}"' RETURN
  local base="https://github.com/neo4j/mcp/releases/download/v${NEO4J_MCP_VERSION}"
  curl -fsSL "${base}/${asset}" -o "${tmp}/${asset}"
  curl -fsSL "${base}/neo4j-mcp_${NEO4J_MCP_VERSION}_checksums.txt" -o "${tmp}/checksums.txt"
  (cd "${tmp}" && grep " ${asset}\$" checksums.txt | sha256sum -c -)
  tar -xzf "${tmp}/${asset}" -C "${tmp}"
  install -m 0755 "${tmp}/neo4j-mcp" "${BIN_DIR}/neo4j-mcp"
  echo "installed neo4j-mcp -> ${BIN_DIR}/neo4j-mcp"
}

install_uv() {
  if command -v uv >/dev/null 2>&1; then
    echo "uv already installed: $(uv --version)"
    return
  fi
  python3 -m pip install --user --upgrade uv
  echo "installed uv: $("${BIN_DIR}/uv" --version)"
}

install_neo4j_mcp
install_uv
