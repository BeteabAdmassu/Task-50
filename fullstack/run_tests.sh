#!/bin/bash
# Unified test execution script
set -e

if [ ! -d "backend/node_modules" ]; then
  echo 'Installing backend dependencies...'
  (cd backend && npm install)
fi

echo 'Running Unit Tests...'
node --test --test-concurrency=1 unit_tests/*.test.js

echo 'Running API Tests...'
node --test --test-concurrency=1 API_tests/*.test.js
