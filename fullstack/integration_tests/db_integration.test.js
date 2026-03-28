import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import app from "../backend/src/app.js";
import { pool } from "../backend/src/db.js";

const dbIntegrationEnabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";
const adminUsername = process.env.DB_INT_ADMIN_USER || "admin";
const adminPassword = process.env.DB_INT_ADMIN_PASS || "AdminPassw0rd!";
const clerkUsername = process.env.DB_INT_CLERK_USER || "clerk1";
const clerkPassword = process.env.DB_INT_CLERK_PASS || "ClerkPassw0rd!";

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
}
