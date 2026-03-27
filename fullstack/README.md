# ForgeOps Manufacturing & Workforce Hub

Offline-ready full-stack site for inbound receiving, production planning, and workforce onboarding.

## Stack

- Frontend: Vue 3 + Pinia + Vue Router (Vite)
- Backend: Koa REST APIs
- Database: MySQL
- Auth: JWT + server-side session table with idle timeout

## Implemented Modules

- Authentication and role-based workspace routing
- RBAC and ABAC middleware controls
- Dock scheduling in 30-minute windows with conflict checks
- PO receiving, inspection discrepancy handling, and receipt close validation
- Putaway recommendations with capacity and SKU+lot mixed-storage rule
- 12-week MPS and MRP calculation endpoint
- Work orders, event logging, plan adjustments, and supervisor approvals
- Candidate application intake, duplicate detection, and attachment classification
- Notification subscriptions, digests, DND handling, and in-app dispatch queue
- Offline connector message export queue with retry metadata
- Search endpoint with synonym expansion + metadata filters
- Immutable audit logging for create/update/approve actions
- Sensitive data encryption at rest and masked retrieval
- Versioned scoring rules and weighted GPA scoring with recalc backtracking flags

## Setup

1. Create a MySQL database named `forgeops`.
2. Apply `backend/schema.sql`, then `backend/seed.sql`.
3. Install backend deps:

```bash
cd backend
npm install
npm run start
```

Before starting backend in non-development environments, set secrets explicitly:
- `JWT_SECRET` (required outside development/test)
- `ENCRYPTION_KEY_HEX` (64-char hex, required outside development/test)

4. Seed demo users:

```bash
node scripts/seed-users.js
```

5. Install frontend deps and run:

```bash
cd ../frontend
cp .env.example .env
npm install
npm run dev
```

Windows PowerShell/CMD equivalent:

```powershell
cd ..\frontend
copy .env.example .env
npm install
npm run dev
```

Frontend API base is configurable with `VITE_API_BASE_URL`.
- If not set, frontend defaults to `${window.location.protocol}//${window.location.hostname}:4000/api`.
- Example for LAN usage is provided in `frontend/.env.example`.

Notification Do Not Disturb (DND) window can be set per subscription via
`POST /api/notifications/subscriptions` payload fields:
- `dndStart` (default `21:00`)
- `dndEnd` (default `07:00`)

Sensitive candidate fields (DOB/SSN last4) are unmasked only when the actor role
has the explicit `SENSITIVE_DATA_VIEW` permission.

## Offline Connector Queue

- Offline mode uses in-app notifications as active delivery channel.
- External connector channels (email/SMS/IM) are queued as export files and tracked in `message_queue`.
- API flows:
  - `POST /api/notifications/offline-queue` creates queued connector export files.
  - `POST /api/notifications/offline-queue/retry` increments retries and tracks status transitions.

## Test Commands

Linux/macOS/Git Bash:

```bash
cd fullstack
node --test --test-concurrency=1 unit_tests/*.test.js
node --test --test-concurrency=1 API_tests/*.test.js
```

Windows PowerShell/CMD:

```powershell
cd fullstack
node --test --test-concurrency=1 unit_tests/*.test.js
node --test --test-concurrency=1 API_tests/*.test.js
cd frontend
npm.cmd run build
```
