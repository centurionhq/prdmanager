#!/usr/bin/env bash
# SDD-006 §Aislamiento por capas: `prdm_owner` (the bootstrap superuser, `$POSTGRES_USER`) owns the
# schema and runs migrations; `prdm_app` is the role the server actually connects as — LOGIN, no
# superuser, no BYPASSRLS, no CREATE on the schema, and never a member of `prdm_owner`. Runs once per
# fresh PGDATA (docker-entrypoint-initdb.d only fires on first init), so it applies the same way to the
# persistent `postgres` service and to `postgres-test`'s tmpfs volume, which reinitializes every start.
set -euo pipefail

: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD must be set in .env}"
: "${POSTGRES_USER:?POSTGRES_USER must be set (expected prdm_owner)}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"

# Password is passed to psql over stdin (never as a CLI argument), so it never appears in `ps`.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	DO \$\$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'prdm_app') THEN
	    CREATE ROLE prdm_app LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}'
	      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
	  END IF;
	END
	\$\$;

	-- prdm_app must never be able to assume prdm_owner's privileges (SDD-006 test de catálogo).
	REVOKE ALL PRIVILEGES ON DATABASE "${POSTGRES_DB}" FROM PUBLIC;
	GRANT CONNECT ON DATABASE "${POSTGRES_DB}" TO prdm_app;
	GRANT USAGE ON SCHEMA public TO prdm_app;
EOSQL
