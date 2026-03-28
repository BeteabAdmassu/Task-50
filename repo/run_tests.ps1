$ErrorActionPreference = "Stop"

if (-not (Test-Path "backend/node_modules")) {
  Write-Host "Installing backend dependencies..."
  Push-Location "backend"
  try {
    npm.cmd install
  }
  finally {
    Pop-Location
  }
}

if (-not (Test-Path "frontend/node_modules")) {
  Write-Host "Installing frontend dependencies..."
  Push-Location "frontend"
  try {
    npm.cmd install
  }
  finally {
    Pop-Location
  }
}

Write-Host "Running Unit Tests..."
node --test --test-concurrency=1 unit_tests/*.test.js

Write-Host "Running API Tests..."
node --test --test-concurrency=1 API_tests/*.api.test.js

Write-Host "Running Integration Tests..."
node --test --test-concurrency=1 integration_tests/*.test.js

Write-Host "Running Frontend Tests..."
Push-Location "frontend"
try {
  npm.cmd run test
  Write-Host "Building Frontend..."
  npm.cmd run build
}
finally {
  Pop-Location
}
