import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import app from "../backend/src/app.js";
import { pool } from "../backend/src/db.js";
import { runDbPreflightChecks } from "./db_preflight.js";

const fullIntegrationEnabled = process.env.RUN_DB_INTEGRATION_TESTS === "1";
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
}

if (fullIntegrationEnabled) {
  test("DB smoke preflight covered by RUN_DB_INTEGRATION_TESTS=1", { skip: true }, () => {});
} else {
  after(async () => {
    await pool.end();
  });

  test("DB smoke preflight checks connectivity/schema/seeded-user logins", async () => {
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
  });
}
