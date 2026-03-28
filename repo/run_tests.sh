#!/bin/bash
# Unified test execution script
set -e

if [ ! -d "backend/node_modules" ]; then
  echo 'Installing backend dependencies...'
  (cd backend && npm install)
fi

if [ ! -d "frontend/node_modules" ]; then
  echo 'Installing frontend dependencies...'
  (cd frontend && npm install)
fi

echo 'Running Unit Tests...'
node --test --test-concurrency=1 unit_tests/*.test.js

echo 'Running API Tests...'
node --test --test-concurrency=1 API_tests/*.api.test.js

echo 'Running Integration Tests...'
node --test --test-concurrency=1 integration_tests/*.test.js

echo 'Running Frontend Tests...'
(cd frontend && npm run test)

echo 'Building Frontend...'
(cd frontend && npm run build)
