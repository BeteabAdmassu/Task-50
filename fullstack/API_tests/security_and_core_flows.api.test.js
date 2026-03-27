import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import jwt from "../backend/node_modules/jsonwebtoken/index.js";
import app from "../backend/src/app.js";
import { pool } from "../backend/src/db.js";
import { config } from "../backend/src/config.js";

const originalExecute = pool.execute;
const originalGetConnection = pool.getConnection;

async function startServer() {
  const server = createServer(app.callback());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`
  };
}

test("POST /api/hr/applications/:id/attachments rejects unauthenticated upload", async () => {
  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/hr/applications/1/attachments`, {
    method: "POST"
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.match(body.error, /Attachment upload requires authorized user or valid candidate upload token/);
  await new Promise((resolve) => server.close(resolve));
});

test("POST /api/receiving/dock-appointments returns 409 on slot conflict", async () => {
  const token = jwt.sign({ sub: 3, sessionId: "sess-dock" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-dock",
        user_id: 3,
        last_activity_at: new Date(),
        username: "clerk1",
        role: "CLERK",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM role_permissions rp")) {
      return [[{ 1: 1 }]];
    }
    if (sql.includes("FROM dock_appointments")) {
      return [[{ id: 9 }]];
    }
    throw new Error(`Unexpected SQL: ${sql} params=${JSON.stringify(params)}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/receiving/dock-appointments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      siteId: 1,
      poNumber: "PO-1",
      startAt: "2026-03-30T09:00:00.000Z",
      endAt: "2026-03-30T09:30:00.000Z"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.match(body.error, /Time slot already booked/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/receiving/receipts/:id/close blocks clerk from other site", async () => {
  const token = jwt.sign({ sub: 4, sessionId: "sess-close" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-close",
        user_id: 4,
        last_activity_at: new Date(),
        username: "clerk1",
        role: "CLERK",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM role_permissions rp")) {
      return [[{ 1: 1 }]];
    }
    if (sql.includes("SELECT site_id FROM receipts")) {
      return [[{ site_id: 2 }]];
    }
    throw new Error(`Unexpected SQL: ${sql} params=${JSON.stringify(params)}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/receiving/receipts/123/close`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.match(body.error, /Attribute rule prevented this action/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/hr/applications creates candidate and returns upload token", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM application_form_fields")) {
      return [[{ field_key: "work_eligibility" }]];
    }
    if (sql.includes("FROM candidates WHERE full_name")) {
      return [[]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes("INSERT INTO candidates")) {
        return [{ insertId: 201 }];
      }
      if (sql.includes("INSERT INTO candidate_form_answers")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM application_attachment_requirements")) {
        return [[{ classification: "RESUME" }]];
      }
      if (sql.includes("FROM candidate_attachments")) {
        return [[]];
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  pool.getConnection = async () => conn;

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/hr/applications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullName: "Alex Applicant",
      dob: "1994-01-15",
      ssnLast4: "4455",
      formData: [{ fieldKey: "work_eligibility", fieldValue: "yes" }]
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.id, 201);
  assert.equal(typeof body.uploadToken, "string");
  assert.deepEqual(body.attachmentCompleteness.missingRequiredClasses, ["RESUME"]);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
  pool.getConnection = originalGetConnection;
});

test("GET /api/search returns 401 when unauthenticated", async () => {
  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/search?q=test`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.match(body.error, /Authentication required/);
  await new Promise((resolve) => server.close(resolve));
});

test("GET /api/hr/candidates/:id returns 404 for missing candidate", async () => {
  const token = jwt.sign({ sub: 2, sessionId: "sess-404" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-404",
        user_id: 2,
        last_activity_at: new Date(),
        username: "hr1",
        role: "HR",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 1
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM role_permissions rp")) return [[{ 1: 1 }]];
    if (sql.includes("FROM candidates WHERE id = ?")) return [[]];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/hr/candidates/99999`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.match(body.error, /Candidate not found/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/notifications/subscriptions rejects invalid DND format with 400", async () => {
  const token = jwt.sign({ sub: 2, sessionId: "sess-bad-dnd" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-bad-dnd",
        user_id: 2,
        last_activity_at: new Date(),
        username: "hr1",
        role: "HR",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 1
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/notifications/subscriptions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ topic: "RECEIPT_ACK", frequency: "DAILY", dndStart: "99:99", dndEnd: "07:00" })
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /DND window must be in HH:mm format/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/receiving/receipts/:id/close succeeds for same-site clerk", async () => {
  const token = jwt.sign({ sub: 4, sessionId: "sess-close-ok" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-close-ok",
        user_id: 4,
        last_activity_at: new Date(),
        username: "clerk1",
        role: "CLERK",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM role_permissions rp")) return [[{ 1: 1 }]];
    if (sql.includes("SELECT site_id FROM receipts")) return [[{ site_id: 1 }]];
    if (sql.includes("FROM receipts WHERE id = ?")) {
      return [[{ id: 123, site_id: 1, status: "OPEN", received_by: 4 }]];
    }
    if (sql.includes("FROM receipt_discrepancies")) return [[]];
    if (sql.includes("FROM receipt_lines rl")) return [[]];
    if (sql.includes("UPDATE receipts SET status = 'CLOSED'")) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/receiving/receipts/123/close`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});
