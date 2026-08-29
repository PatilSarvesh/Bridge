-- Local development roles only. These fixed values are intentionally
-- non-production credentials and must never be reused outside this compose
-- project. Production role passwords belong in the deployment secret system.
CREATE ROLE bridge_migrator LOGIN PASSWORD 'bridge_migrator' NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE bridge_runtime LOGIN PASSWORD 'bridge_runtime' NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE bridge_maintenance LOGIN PASSWORD 'bridge_maintenance' NOSUPERUSER BYPASSRLS NOINHERIT;

-- The isolated integration database is created once with the local stack so
-- contributors can opt into the PostgreSQL test suite without touching the
-- development database.
CREATE DATABASE bridge_test OWNER bridge;
