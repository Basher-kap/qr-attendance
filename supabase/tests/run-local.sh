#!/usr/bin/env bash
# Tests the database files (schema, migrations 003 and 004, and the RLS test) on a throw-away
# PostgreSQL. It needs psql and createdb, and the usual PG* variables (PGHOST, PGUSER, ...).
#   npm run security:db
# It proves three things: the RLS test passes on a brand-new project, it passes on an existing
# project after migration 004 (also when 004 is run twice), and the test really does catch the
# problem on the old setup (so a pass means something).
set -euo pipefail
cd "$(dirname "$0")/.."

fresh() {
  dropdb --if-exists "$1" >/dev/null 2>&1
  createdb "$1"
  psql -q -v ON_ERROR_STOP=1 -d "$1" -f tests/local-stub.sql
}
rls() { psql -q -v ON_ERROR_STOP=1 -d "$1" -f tests/rls.test.sql 2>&1; }
expect_pass() {
  local out; out=$(rls "$1") || { echo "$out"; echo "FAILED: $2"; exit 1; }
  local n; n=$(grep -c "PASS:" <<<"$out")
  [ "$n" -ge 20 ] || { echo "$out"; echo "FAILED: only $n checks passed ($2)"; exit 1; }
  echo "ok  $2 ($n checks passed)"
}

echo "== Existing project: migration 003, then 004 =="
fresh qr_test_old
psql -q -d qr_test_old -c "create type session_type as enum ('morning','afternoon'); create type scan_type as enum ('check_in','check_out');"
psql -q -v ON_ERROR_STOP=1 -d qr_test_old -f migrations/003_private_per_account.sql >/dev/null
if rls qr_test_old >/dev/null 2>&1; then
  echo "FAILED: the test did not catch the old setup"; exit 1
fi
echo "ok  the test detects the missing protections before migration 004"
psql -q -v ON_ERROR_STOP=1 -d qr_test_old -f migrations/004_security_hardening.sql
expect_pass qr_test_old "after migration 004"
psql -q -v ON_ERROR_STOP=1 -d qr_test_old -f migrations/004_security_hardening.sql
expect_pass qr_test_old "after running migration 004 a second time"

echo "== New project: schema.sql =="
fresh qr_test_new
psql -q -v ON_ERROR_STOP=1 -d qr_test_new -f schema.sql
expect_pass qr_test_new "schema.sql"

dropdb qr_test_old; dropdb qr_test_new
echo "All database security checks passed."
