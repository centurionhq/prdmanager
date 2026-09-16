---
id: ADR-001
type: ADR
title: "Neo4j Community local como base de datos de grafos"
status: active
architects: ["PRD-001"]
impacts_paths: ["docker-compose.yml", "scripts/**", ".mcp.json"]
created_at: 2026-09-12
tags: ["architecture-decision", "neo4j", "database", "docker"]
---

## Contexto

Necesitamos una base de datos de grafos para indexar la estructura de producto (Feature Tree → Blueprints → Work Orders → Código), recorrer dependencias de profundidad variable y exponer consultas a asistentes de IA vía MCP. Requisitos:

1. Servicio local en Docker, sin dependencia de cloud.
2. Recorridos de profundidad variable (MRD → PRD → FR → SDD → WO → commit/código).
3. Lenguaje de consultas declarativo para grafos.
4. Índice full-text para triaje de feedback y auto-link de artifacts.
5. Tooling de gestión para humanos (UI) y para agentes (MCP + skills).
6. Licencia gratuita.

## Opciones Consideradas

| Opción | Pros | Contras |
|---|---|---|
| **Neo4j Community 2026.08.1 + APOC (Docker)** | Cypher 25; APOC (`apoc.path.subgraphAll`, utilidades de colecciones); índice full-text Lucene; Neo4j Browser; MCP oficial `neo4j/mcp` y skills oficiales `neo4j-contrib/neo4j-skills` | Community permite una sola base de datos de usuario (tests en instancia separada); consumo de memoria JVM |
| **Memgraph** | Compatible con Cypher, in-memory y rápido; ecosistema MCP en `memgraph/ai-toolkit` | Sin APOC (usa MAGE); menos skills/tooling disponibles para este flujo |
| **FalkorDB** | Liviano, basado en Redis; subconjunto de Cypher | Cobertura de Cypher parcial; MCP de comunidad pequeño y de solo lectura |
| **SQLite como índice embebido** | Cero servicios; FTS5 para full-text | Recorridos del Feature Tree con CTE recursivas; sin tooling de grafos; no cumple el pedido de un servicio de grafos real |
| **Supabase / Postgres** | Postgres confiable, self-hosting posible | Stack de varios servicios; no es un grafo nativo; no estaba configurado en el proyecto |

## Decisión

**Adoptar Neo4j Community `neo4j:2026.08.1-community` en Docker Compose con el plugin APOC, en una red interna sin salida a internet y expuesto solo en 127.0.0.1 (Bolt 7687, Browser 7474) mediante un proxy `alpine/socat:1.8.0.3`, más una instancia `neo4j-test` (perfil `test`, tmpfs, Bolt 7688) para tests de integración.**

### Justificación

1. **Recorridos:** `apoc.path.subgraphAll` y los quantified path patterns de Cypher reconstruyen ramas completas del Feature Tree en una consulta.
2. **Full-text:** el índice `node_text` (Lucene) cubre triaje y auto-link sin middleware adicional.
3. **Idempotencia:** constraints de unicidad + `MERGE` permiten re-indexar desde los documentos en cada `prdm index`.
4. **Tooling para agentes:** MCP oficial (lectura del grafo), MCP de data modeling (validación del modelo) y skills oficiales (Cypher 25, driver JS v6, modelado).
5. **Operación local simple:** un servicio Docker con healthcheck; volúmenes nombrados.

## Consecuencias

### Positivas

- **Neo4j es reconstruible:** los documentos `.md` y `.prdm/baseline.json` en git son la fuente de verdad; si se pierde la base, `prdm db reset --yes` + `prdm index` la regeneran.
- **Consultas de producto nativas:** "features sin camino a código" o "commits sin trazabilidad" son consultas Cypher, no lógica de aplicación.
- **Migración futura:** el mismo Cypher y modelo funcionan en Enterprise o Aura si se necesitan varias bases o HA.

### Negativas

- **Una sola base de usuario en Community:** los tests usan instancias separadas (`neo4j-test`, o instancias efímeras adicionales al paralelizar).
- **Memoria:** heap máximo 1G y pagecache 512M en compose; grafos mucho mayores requieren ajustar esos valores.
- **Datos locales:** `docker compose down -v` borra los volúmenes (`prdmanager_neo4j-data`); no hay pérdida de verdad porque el grafo es derivado.
- **Observabilidad básica:** logs vía `docker logs prdmanager-neo4j`.
- **Sin blocklist de URLs en Community:** `dbms.cypher.ip_blocklist` es exclusivo de Enterprise, por eso el aislamiento de red (red `internal` + proxy) y el allowlist de procedimientos APOC impiden que una consulta de solo lectura (`LOAD CSV`, `apoc.load.*`) envíe datos a internet.

## Tooling de Gestión

| Herramienta | Versión | Instalación | Uso |
|---|---|---|---|
| **neo4j-mcp** (MCP oficial, Go) | 1.6.0 | `scripts/install-tooling.sh` (descarga del release + verificación sha256) | Tools `get-schema`, `read-cypher`; `write-cypher` deshabilitado: `scripts/mcp-neo4j.sh` fuerza `NEO4J_MCP_READ_ONLY=true` y lee `.env` sin ejecutarlo |
| **mcp-neo4j-data-modeling** | 0.8.2 | `uvx mcp-neo4j-data-modeling@0.8.2` (uv 0.12.13 fijado, instalado con pip) | Validar/exportar el modelo (`docs/model/graph-model.json`) |
| **neo4j-skills** (plugin Claude Code) | 1.0.1 | `claude plugin install neo4j-skills@neo4j-skills-marketplace --scope project` | Skills de Cypher, modelado, driver JavaScript, MCP y CLI |
| **cypher-shell** | incluido en la imagen | `docker exec prdmanager-neo4j cypher-shell` | Consultas administrativas |
| **Neo4j Browser** | incluido en la imagen | http://localhost:7474 | Visualización del grafo |

### Comandos

| Comando | Propósito |
|---|---|
| `docker compose up -d` / `prdm db up` | Inicia la base principal y el proxy localhost (healthcheck con `cypher-shell`) |
| `docker compose --profile test up -d neo4j-test` | Inicia la base efímera de tests |
| `prdm db migrate` | Aplica constraints e índices de `src/graph/migrations.ts` (`IF NOT EXISTS`) |
| `prdm db reset --yes` | Borra el grafo, migra y re-indexa |

### Credenciales y red

- Configuración real en `docker-compose.yml`: `NEO4J_AUTH=neo4j/${NEO4J_PASSWORD}` desde `.env` (gitignored, generado con `openssl rand -hex 16`); `.env.example` versionado sin secretos.
- Las variables `NEO4J_*` dentro del contenedor se interpretan como settings de Neo4j, por eso el healthcheck obtiene la contraseña de `NEO4J_AUTH` y no se define `NEO4J_PASSWORD` en el contenedor.
- Puertos publicados solo en 127.0.0.1 por el proxy; el contenedor de Neo4j no tiene puertos propios ni ruta a internet.
- Allowlist de procedimientos: `apoc.path.*,apoc.coll.*,apoc.meta.*,apoc.version`; `allow_csv_import_from_file_urls=false`.

## Referencias

- MCP oficial de Neo4j: https://github.com/neo4j/mcp
- MCP servers de neo4j-contrib (data modeling): https://github.com/neo4j-contrib/mcp-neo4j
- Skills de Neo4j: https://github.com/neo4j-contrib/neo4j-skills

## Tareas

- [ ] Mantener la infraestructura local de Neo4j, el proxy y el tooling MCP gobernados por este ADR
