#!/bin/bash
# Unified test execution script — CI-safe.
# Requires only Docker (with Compose) on the host; no Node.js needed.
set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve docker compose command (v2 plugin or legacy standalone v1)
# ---------------------------------------------------------------------------
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif docker-compose version >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "ERROR: 'docker compose' is required but was not found on PATH." >&2
  exit 1
fi

# Default: run full DB integration tests unless explicitly disabled
RUN_DB_INTEGRATION_TESTS="${RUN_DB_INTEGRATION_TESTS:-1}"

echo "==> Executing test suite inside Docker (test-runner service)..."

$DC run --rm \
  -e "RUN_DB_INTEGRATION_TESTS=${RUN_DB_INTEGRATION_TESTS}" \
  test-runner \
  sh -c '
    set -e

    echo "--- Installing backend dependencies ---"
    (cd /workspace/backend && npm ci)

    echo "--- Installing frontend dependencies ---"
    (cd /workspace/frontend && npm ci)

    cd /workspace

    echo "--- Running Unit Tests ---"
    node --test --test-concurrency=1 unit_tests/*.test.js

    echo "--- Running API Tests ---"
    node --test --test-concurrency=1 API_tests/*.api.test.js

    echo "--- Running Integration Tests ---"
    if [ -z "${RUN_DB_INTEGRATION_TESTS:-}" ]; then
      export RUN_DB_INTEGRATION_TESTS=1
      echo "RUN_DB_INTEGRATION_TESTS not set. Defaulting to full DB integration verification."
    fi
    if node --test --test-concurrency=1 integration_tests/*.test.js; then
      echo "Integration boundary: full DB integration executed."
    else
      echo "Integration boundary: DB prerequisites missing or integration failed."
      echo "Action: apply backend/schema.sql, backend/seed.sql, then run node backend/scripts/seed-users.js"
      exit 1
    fi

    echo "--- Running Frontend Tests ---"
    (cd /workspace/frontend && npm run test)

    echo "--- Building Frontend ---"
    (cd /workspace/frontend && npm run build)
  '

echo "==> All tests completed successfully."
