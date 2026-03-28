import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { publishEvent } from "../backend/src/services/notification-service.js";
import app from "../backend/src/app.js";
import { pool } from "../backend/src/db.js";

const dbIntegrationEnabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const adminUsername = process.env.DB_INT_ADMIN_USER || "admin";
const adminPassword = process.env.DB_INT_ADMIN_PASS || "AdminPassw0rd!";
const clerkUsername = process.env.DB_INT_CLERK_USER || "clerk1";
const clerkPassword = process.env.DB_INT_CLERK_PASS || "ClerkPassw0rd!";
const setupSteps = [
  "1) Apply DB schema: backend/schema.sql",
  "2) Apply DB seed data: backend/seed.sql",
  "3) Seed users: node backend/scripts/seed-users.js"
].join("\n");

async function startServer() {
  const server = createServer(app.callback());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`
  };
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const body = await response.json();
  assert.equal(response.status, 200, `login failed for ${username}: ${body.error || "unknown"}`);
  return body;
}

function preflightError(reason, details = "") {
  const detailText = details ? `\nDetails: ${details}` : "";
  return new Error(
    `[DB integration preflight failed] ${reason}${detailText}\n` +
      "Required setup before RUN_DB_INTEGRATION_TESTS=1:\n" +
      setupSteps
  );
}

async function runDbPreflightChecks() {
  try {
    await pool.execute("SELECT 1 AS ok");
  } catch (err) {
    throw preflightError("Database connectivity check failed (SELECT 1).", err.message);
  }

  const requiredTables = [
    "users",
    "sessions",
    "receipts",
    "audit_logs",
    "notification_subscriptions",
    "notifications",
    "message_queue"
  ];
  const [tableRows] = await pool.execute(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()`
  );
  const present = new Set(tableRows.map((row) => row.table_name));
  const missing = requiredTables.filter((name) => !present.has(name));
  if (missing.length) {
    throw preflightError("Required tables are missing.", `Missing: ${missing.join(", ")}`);
  }

  const [userRows] = await pool.execute(
    "SELECT username FROM users WHERE username IN (?, ?)",
    [adminUsername, clerkUsername]
  );
  const usersFound = new Set(userRows.map((row) => row.username));
  if (!usersFound.has(adminUsername) || !usersFound.has(clerkUsername)) {
    throw preflightError(
      "Seeded users are missing for integration tests.",
      `Expected users: ${adminUsername}, ${clerkUsername}`
    );
  }

  const { server, baseUrl } = await startServer();
  try {
    await login(baseUrl, adminUsername, adminPassword);
    await login(baseUrl, clerkUsername, clerkPassword);
  } catch (err) {
    throw preflightError(
      "Seeded user login precondition failed (admin/clerk credentials).",
      err.message
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (!dbIntegrationEnabled) {
  test("DB integration tests skipped without RUN_DB_INTEGRATION_TESTS=1", { skip: true }, () => {});
} else {
  await runDbPreflightChecks();

  after(async () => {
    await pool.end();
  });

  test("integration: login -> session use -> logout lifecycle", async () => {
    const { server, baseUrl } = await startServer();
    const loginResult = await login(baseUrl, adminUsername, adminPassword);
    assert.equal(typeof loginResult.token, "string");

    const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${loginResult.token}` }
    });
    const meBody = await meResponse.json();
    assert.equal(meResponse.status, 200);
    assert.equal(meBody.user.username, adminUsername);

    const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${loginResult.token}` }
    });
    assert.equal(logoutResponse.status, 200);

    const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${loginResult.token}` }
    });
    assert.ok([401, 403].includes(meAfterLogout.status));

    await new Promise((resolve) => server.close(resolve));
  });

  test("integration: create receipt -> close receipt -> audit row exists", async () => {
    const { server, baseUrl } = await startServer();
    const loginResult = await login(baseUrl, clerkUsername, clerkPassword);
    const poNumber = `PO-INT-${Date.now()}`;

    const createRes = await fetch(`${baseUrl}/api/receiving/receipts`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${loginResult.token}`
      },
      body: JSON.stringify({
        siteId: 1,
        poNumber,
        lines: [
          {
            poLineNo: "1",
            sku: "INT-SKU-1",
            lotNo: "INT-LOT-1",
            qtyExpected: 10,
            qtyReceived: 10,
            inspectionStatus: "PASS",
            storageLocationId: null
          }
        ]
      })
    });
    const createBody = await createRes.json();
    assert.equal(createRes.status, 200);
    assert.ok(createBody.id);

    const closeRes = await fetch(`${baseUrl}/api/receiving/receipts/${createBody.id}/close`, {
      method: "POST",
      headers: { authorization: `Bearer ${loginResult.token}` }
    });
    assert.equal(closeRes.status, 200);

    const [auditRows] = await pool.execute(
      `SELECT id
       FROM audit_logs
       WHERE entity_type = 'receipt'
         AND entity_id = ?
         AND action = 'APPROVE'
       ORDER BY id DESC
       LIMIT 1`,
      [String(createBody.id)]
    );
    assert.equal(auditRows.length, 1);

    await new Promise((resolve) => server.close(resolve));
  });

  test("integration: offline queue export + retry state transitions", async () => {
    const { server, baseUrl } = await startServer();
    const loginResult = await login(baseUrl, adminUsername, adminPassword);

    const queueRes = await fetch(`${baseUrl}/api/notifications/offline-queue`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${loginResult.token}`
      },
      body: JSON.stringify({
        channel: "EMAIL",
        recipient: "integration@example.local",
        subject: "Integration export",
        body: "connector payload"
      })
    });
    const queueBody = await queueRes.json();
    assert.equal(queueRes.status, 200);
    assert.ok(queueBody.id);
    await fs.access(queueBody.filePath);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const retryRes = await fetch(`${baseUrl}/api/notifications/offline-queue/retry`, {
        method: "POST",
        headers: { authorization: `Bearer ${loginResult.token}` }
      });
      assert.equal(retryRes.status, 200);
    }

    const [[row]] = await pool.execute(
      `SELECT retry_count, status
       FROM message_queue
       WHERE id = ?`,
      [queueBody.id]
    );
    assert.ok(Number(row.retry_count) >= 3);
    assert.equal(row.status, "FAILED");

    await new Promise((resolve) => server.close(resolve));
  });

  test("integration: same-day DND subscription defers delivery until DND end", async () => {
    const { server, baseUrl } = await startServer();
    const loginResult = await login(baseUrl, adminUsername, adminPassword);
    const actor = loginResult.user;
    const testStartedAt = new Date();

    const subRes = await fetch(`${baseUrl}/api/notifications/subscriptions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${loginResult.token}`
      },
      body: JSON.stringify({
        topic: "RECEIPT_ACK",
        frequency: "IMMEDIATE",
        dndStart: "13:00",
        dndEnd: "17:00"
      })
    });
    assert.equal(subRes.status, 200);

    const simulatedNow = new Date();
    simulatedNow.setHours(14, 15, 0, 0);
    await publishEvent(
      "RECEIPT_ACK",
      { receiptId: `DND-${Date.now()}` },
      { id: actor.id },
      simulatedNow
    );

    const [rows] = await pool.execute(
      `SELECT status, deliver_after, created_at
       FROM notifications
       WHERE user_id = ?
         AND event_type = 'RECEIPT_ACK'
         AND created_at >= ?
       ORDER BY id DESC
       LIMIT 1`,
      [actor.id, testStartedAt]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "PENDING");

    const deliverAfter = new Date(rows[0].deliver_after);
    assert.equal(deliverAfter.getHours(), 17);
    assert.equal(deliverAfter.getMinutes(), 0);
    assert.ok(deliverAfter.getTime() > simulatedNow.getTime());

    await new Promise((resolve) => server.close(resolve));
  });
}
