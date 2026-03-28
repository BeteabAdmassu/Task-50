import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import { publishEvent } from "../backend/src/services/notification-service.js";
import app from "../backend/src/app.js";
import { pool } from "../backend/src/db.js";
import { runDbPreflightChecks } from "./db_preflight.js";
import { integrationPoolLifecycle } from "./pool-lifecycle.js";

const dbIntegrationEnabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const adminUsername = process.env.DB_INT_ADMIN_USER || "admin";
const adminPassword = process.env.DB_INT_ADMIN_PASS || "AdminPassw0rd!";
const clerkUsername = process.env.DB_INT_CLERK_USER || "clerk1";
const clerkPassword = process.env.DB_INT_CLERK_PASS || "ClerkPassw0rd!";
const releaseSuitePool = integrationPoolLifecycle.acquireSuite();

after(async () => {
  await releaseSuitePool();
});

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

if (!dbIntegrationEnabled) {
  test("DB integration tests skipped without RUN_DB_INTEGRATION_TESTS=1", { skip: true }, () => {});
} else {
  await runDbPreflightChecks({
    adminUsername,
    clerkUsername,
    verifyLogins: async () => {
      const { server, baseUrl } = await startServer();
      try {
        await login(baseUrl, adminUsername, adminPassword);
        await login(baseUrl, clerkUsername, clerkPassword);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    }
  });

  test("integration: login -> session use -> logout lifecycle", async () => {
    const { server, baseUrl } = await startServer();
    try {
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
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("integration: create receipt -> close receipt -> audit row exists", async () => {
    const { server, baseUrl } = await startServer();
    try {
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
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("integration: offline queue retry preserves queued rows and processes failed rows", async () => {
    const { server, baseUrl } = await startServer();
    try {
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

      const [[queuedRow]] = await pool.execute(
        `SELECT retry_count, status
         FROM message_queue
         WHERE id = ?`,
        [queueBody.id]
      );
      assert.equal(Number(queuedRow.retry_count), 0);
      assert.equal(queuedRow.status, "QUEUED");

      await pool.execute(
        `UPDATE message_queue
         SET status = 'FAILED', retry_count = 1
         WHERE id = ?`,
        [queueBody.id]
      );

      const failedRetryRes = await fetch(`${baseUrl}/api/notifications/offline-queue/retry`, {
        method: "POST",
        headers: { authorization: `Bearer ${loginResult.token}` }
      });
      assert.equal(failedRetryRes.status, 200);

      const [[failedRow]] = await pool.execute(
        `SELECT retry_count, status
         FROM message_queue
         WHERE id = ?`,
        [queueBody.id]
      );
      assert.equal(Number(failedRow.retry_count), 2);
      assert.equal(failedRow.status, "QUEUED");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("integration: same-day DND subscription defers delivery until DND end", async () => {
    const { server, baseUrl } = await startServer();
    try {
      const loginResult = await login(baseUrl, adminUsername, adminPassword);
      const actor = loginResult.user;
      const receiptId = `DND-${Date.now()}`;

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
      const expectedRelease = new Date(simulatedNow);
      expectedRelease.setHours(17, 0, 0, 0);

      await publishEvent(
        "RECEIPT_ACK",
        { receiptId },
        { id: actor.id },
        simulatedNow
      );

      const [rows] = await pool.execute(
        `SELECT status, deliver_after, created_at, message
         FROM notifications
         WHERE user_id = ?
           AND event_type = 'RECEIPT_ACK'
           AND message LIKE ?
         ORDER BY id DESC
         LIMIT 1`,
        [actor.id, `%${receiptId}%`]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, "PENDING");

      const deliverAfter = new Date(rows[0].deliver_after);
      assert.equal(deliverAfter.getTime(), expectedRelease.getTime());
      assert.ok(deliverAfter.getTime() > simulatedNow.getTime());
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
}
