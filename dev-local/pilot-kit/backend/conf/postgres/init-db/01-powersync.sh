#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Postgres setup for PowerSync replication. Runs on FIRST init only — the official
# entrypoint skips this directory entirely once ./data/postgres holds a database.
#
# A shell script rather than plain .sql because the replication role's password has to
# come from the environment. It is a role with REPLICATION and BYPASSRLS on the pilot's
# own database, so shipping one fixed password inside the kit would mean every site
# runs with the same one, published in the repository.
#
# See https://docs.powersync.com/configuration/source-db/setup
set -eu

: "${POWERSYNC_DB_PASSWORD:?set it in .env — scripts/gen-secrets.sh generates it}"

# -v plus :'role_password' so psql quotes and escapes the value itself; interpolating it
# into the SQL text would be an injection waiting for the first password with a quote.
psql -v ON_ERROR_STOP=1 -v role_password="$POWERSYNC_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname postgres <<'SQL'
CREATE SCHEMA IF NOT EXISTS "powersync";

CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD :'role_password';

-- USAGE is required from PostgreSQL 15 on, where schema privileges are revoked by default.
GRANT USAGE ON SCHEMA powersync TO powersync_role;
GRANT SELECT ON ALL TABLES IN SCHEMA powersync TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA powersync GRANT SELECT ON TABLES TO powersync_role;
CREATE PUBLICATION powersync FOR ALL TABLES;

-- Bucket storage gets its own database, so PowerSync's tables cannot collide with the
-- application's. See https://docs.powersync.com/configuration/powersync-service/self-hosted-instances
CREATE DATABASE powersync_storage OWNER postgres;
SQL
