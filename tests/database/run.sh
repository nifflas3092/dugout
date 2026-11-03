#!/usr/bin/env bash
# Builds a fresh throwaway database, loads a stand-in for Supabase's auth, then the real schema, then attacks it.
set -euo pipefail
cd "$(dirname "$0")"
DB=${PGDATABASE:-dugout_test}
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5432} -U ${PGUSER:-postgres} -q"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -v ON_ERROR_STOP=1 -f supabase_stub.sql
$P -d $DB -v ON_ERROR_STOP=1 -f ../../supabase/schema.sql 2>&1 | grep -v NOTICE || true
$P -d $DB -v ON_ERROR_STOP=1 -f ../../supabase/schema.sql 2>&1 | grep -v NOTICE || true   # must be safe to run twice
PGDATABASE=$DB python3 attack.py
