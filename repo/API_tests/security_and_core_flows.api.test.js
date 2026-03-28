import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import jwt from "../backend/node_modules/jsonwebtoken/index.js";
import bcrypt from "../backend/node_modules/bcryptjs/index.js";
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

test("POST /api/auth/login returns sensitiveDataView from permission mapping", async () => {
  const passwordHash = await bcrypt.hash("CorrectPassword123", 4);

  pool.execute = async (sql, params) => {
    if (sql.includes("FROM users WHERE username = ?")) {
      return [[{
        id: 77,
        username: "candidate1",
        role: "CANDIDATE",
        password_hash: passwordHash,
        failed_login_attempts: 0,
        locked_until: null,
        site_id: 1,
        department_id: 1,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("failed_login_attempts = 0")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO sessions")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql} params=${JSON.stringify(params)}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ username: "candidate1", password: "CorrectPassword123" })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.user.sensitiveDataView, false);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
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

test("POST /api/receiving/receipts/:id/close blocks supervisor from other site", async () => {
  const token = jwt.sign({ sub: 12, sessionId: "sess-close-supervisor" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-close-supervisor",
        user_id: 12,
        last_activity_at: new Date(),
        username: "supervisor1",
        role: "PLANNER_SUPERVISOR",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
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

test("POST /api/receiving/putaway/recommend denies cross-site clerk request", async () => {
  const token = jwt.sign({ sub: 4, sessionId: "sess-putaway-cross-site" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-putaway-cross-site",
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
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM role_permissions rp")) {
      return [[{ 1: 1 }]];
    }
    throw new Error(`Unexpected SQL: ${sql} params=${JSON.stringify(params)}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/receiving/putaway/recommend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ siteId: 2, sku: "SKU-1", lotNo: "LOT-1", quantity: 10 })
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.match(body.error, /Putaway recommendations are limited to your site/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/receiving/putaway/recommend requires siteId", async () => {
  const token = jwt.sign({ sub: 4, sessionId: "sess-putaway-site-required" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-putaway-site-required",
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
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM role_permissions rp")) {
      return [[{ 1: 1 }]];
    }
    throw new Error(`Unexpected SQL: ${sql} params=${JSON.stringify(params)}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/receiving/putaway/recommend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ sku: "SKU-1", lotNo: "LOT-1", quantity: 10 })
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /siteId required/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/receiving/putaway/recommend returns same-site bin recommendation", async () => {
  const token = jwt.sign({ sub: 4, sessionId: "sess-putaway-success" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-putaway-success",
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
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM role_permissions rp")) {
      return [[{ 1: 1 }]];
    }
    if (sql.includes("FROM inventory_locations")) {
      assert.equal(params[0], 1);
      return [[{
        id: 99,
        code: "A-01",
        capacity_qty: 100,
        occupied_qty: 40,
        current_sku: "SKU-1",
        current_lot: "LOT-1"
      }]];
    }
    throw new Error(`Unexpected SQL: ${sql} params=${JSON.stringify(params)}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/receiving/putaway/recommend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ siteId: 1, sku: "SKU-1", lotNo: "LOT-1", quantity: 10 })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.locationId, 99);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/receiving/putaway/recommend returns 409 when no valid site bin exists", async () => {
  const token = jwt.sign({ sub: 4, sessionId: "sess-putaway-no-bin" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-putaway-no-bin",
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
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM role_permissions rp")) {
      return [[{ 1: 1 }]];
    }
    if (sql.includes("FROM inventory_locations")) {
      return [[{
        id: 99,
        code: "A-01",
        capacity_qty: 20,
        occupied_qty: 20,
        current_sku: null,
        current_lot: null
      }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/receiving/putaway/recommend`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ siteId: 1, sku: "SKU-1", lotNo: "LOT-1", quantity: 10 })
  });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.match(body.error, /No valid location found for putaway/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/receiving/receipts captures inspection status per line", async () => {
  const token = jwt.sign({ sub: 4, sessionId: "sess-receipt-inspection" }, config.jwtSecret, { expiresIn: 3600 });
  let capturedInspectionStatus = null;

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-receipt-inspection",
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
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM role_permissions rp")) {
      return [[{ 1: 1 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params) {
      if (sql.includes("INSERT INTO receipts")) {
        return [{ insertId: 555 }];
      }
      if (sql.includes("INSERT INTO receipt_lines")) {
        capturedInspectionStatus = params[7];
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        return [{ insertId: 1 }];
      }
      if (sql.includes("INSERT INTO search_documents")) {
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  pool.getConnection = async () => conn;

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/receiving/receipts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      siteId: 1,
      poNumber: "PO-INSPECT-1",
      lines: [
        {
          poLineNo: "1",
          sku: "SKU-1",
          lotNo: "LOT-1",
          batchNo: "BATCH-1",
          qtyExpected: 10,
          qtyReceived: 10,
          inspectionStatus: "FAIL"
        }
      ]
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.id, 555);
  assert.equal(capturedInspectionStatus, "FAIL");

  
  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
  pool.getConnection = originalGetConnection;
});

test("POST /api/hr/applications creates candidate and returns upload token", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("INSERT INTO search_documents")) {
      return [{ affectedRows: 1 }];
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
      if (sql.includes("INSERT INTO search_documents")) {
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

test("POST /api/hr/applications repeated submission sets duplicateFlag", async () => {
  const savedCandidates = [];
  let nextId = 400;

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM application_form_fields")) {
      return [[{ field_key: "work_eligibility" }]];
    }
    if (sql.includes("FROM candidates WHERE full_name")) {
      return [savedCandidates.filter((row) => row.full_name === params[0])];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params) {
      if (sql.includes("INSERT INTO candidates")) {
        nextId += 1;
        savedCandidates.push({
          id: nextId,
          full_name: params[0],
          dob_enc: params[3],
          ssn_last4_enc: params[4]
        });
        return [{ insertId: nextId }];
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
      if (sql.includes("INSERT INTO search_documents")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  pool.getConnection = async () => conn;

  const { server, baseUrl } = await startServer();
  const payload = {
    fullName: "Repeat Candidate",
    dob: "1994-11-02",
    ssnLast4: "8899",
    formData: [{ fieldKey: "work_eligibility", fieldValue: "yes" }]
  };

  const firstRes = await fetch(`${baseUrl}/api/hr/applications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const firstBody = await firstRes.json();
  assert.equal(firstRes.status, 200);
  assert.equal(firstBody.duplicateFlag, false);

  const secondRes = await fetch(`${baseUrl}/api/hr/applications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const secondBody = await secondRes.json();
  assert.equal(secondRes.status, 200);
  assert.equal(secondBody.duplicateFlag, true);

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

test("GET /api/search supports pagination and sorting query parameters", async () => {
  const token = jwt.sign({ sub: 4, sessionId: "sess-search-pagination" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-search-pagination",
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
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM search_documents")) {
      assert.ok(sql.includes("MATCH(title, body, tags) AGAINST (? IN BOOLEAN MODE)"));
      return [[
        {
          entity_type: "receipt",
          entity_id: "1",
          title: "Bravo",
          body: "receiving candidate",
          tags: "receipt",
          source: "RECEIVING",
          topic: "INBOUND",
          created_at: new Date("2026-01-02T00:00:00Z")
        },
        {
          entity_type: "receipt",
          entity_id: "2",
          title: "Alpha",
          body: "receiving candidate",
          tags: "receipt",
          source: "RECEIVING",
          topic: "INBOUND",
          created_at: new Date("2026-01-01T00:00:00Z")
        }
      ]];
    }
    throw new Error(`Unexpected SQL: ${sql} params=${JSON.stringify(params)}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/search?q=candidate&page=1&pageSize=1&sortBy=title&sortDir=ASC`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(Array.isArray(body), true);
  assert.equal(body.length, 1);
  assert.equal(body[0].title, "Alpha");

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("GET /api/hr/candidates/:id returns 404 for missing candidate", async () => {
  const token = jwt.sign({ sub: 2, sessionId: "sess-404" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("INSERT INTO search_documents")) return [{ affectedRows: 1 }];
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
    if (sql.includes("INSERT INTO search_documents")) return [{ affectedRows: 1 }];
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

test("POST /api/receiving/receipts/:id/close concurrent attempts allow only one success", async () => {
  const token = jwt.sign({ sub: 44, sessionId: "sess-close-concurrency" }, config.jwtSecret, { expiresIn: 3600 });
  let openConsumed = false;

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-close-concurrency",
        user_id: 44,
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
      if (!openConsumed) {
        openConsumed = true;
        return [[{ id: 777, site_id: 1, status: "OPEN", received_by: 44 }]];
      }
      return [[{ id: 777, site_id: 1, status: "CLOSED", received_by: 44 }]];
    }
    if (sql.includes("FROM receipt_discrepancies")) return [[]];
    if (sql.includes("FROM receipt_lines rl")) return [[]];
    if (sql.includes("UPDATE receipts SET status = 'CLOSED'")) return [{ affectedRows: 1 }];
    if (sql.includes("INSERT INTO search_documents")) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/receiving/receipts/777/close`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    }),
    fetch(`${baseUrl}/api/receiving/receipts/777/close`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    })
  ]);
  const statuses = [resA.status, resB.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 400]);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/planning/work-orders/:id/events rejects downtime without reason code", async () => {
  const token = jwt.sign({ sub: 45, sessionId: "sess-wo-downtime" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-wo-downtime",
        user_id: 45,
        last_activity_at: new Date(),
        username: "planner1",
        role: "PLANNER",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM role_permissions rp")) return [[{ 1: 1 }]];
    if (sql.includes("FROM work_orders wo")) {
      return [[{ id: 900, plan_id: 1, site_id: 1 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/planning/work-orders/900/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ eventType: "DOWNTIME", qty: 0, reasonCode: "", notes: "line stop" })
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Downtime requires reason code/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/planning/adjustments/:id/approve concurrent attempts allow only one success", async () => {
  const token = jwt.sign({ sub: 46, sessionId: "sess-adjust-concurrency" }, config.jwtSecret, { expiresIn: 3600 });
  let pendingConsumed = false;

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-adjust-concurrency",
        user_id: 46,
        last_activity_at: new Date(),
        username: "supervisor1",
        role: "PLANNER_SUPERVISOR",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM role_permissions rp")) return [[{ 1: 1 }]];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes("FROM plan_adjustments WHERE id")) {
        if (!pendingConsumed) {
          pendingConsumed = true;
          return [[{
            id: 88,
            plan_id: 21,
            before_snapshot: JSON.stringify({ status: "DRAFT" }),
            after_snapshot: JSON.stringify({ status: "APPROVED", weeks: [] }),
            status: "PENDING"
          }]];
        }
        return [[{
          id: 88,
          plan_id: 21,
          before_snapshot: JSON.stringify({ status: "DRAFT" }),
          after_snapshot: JSON.stringify({ status: "APPROVED", weeks: [] }),
          status: "APPROVED"
        }]];
      }
      if (sql.includes("FROM production_plans") && sql.includes("FOR UPDATE")) {
        return [[{ id: 21, site_id: 1, plan_name: "Plan", start_week: "2026-03-30", status: "DRAFT" }]];
      }
      if (sql.includes("UPDATE production_plans")) return [{ affectedRows: 1 }];
      if (sql.includes("UPDATE plan_adjustments")) return [{ affectedRows: 1 }];
      if (sql.includes("SELECT id, site_id, plan_name, start_week, status") && !sql.includes("FOR UPDATE")) {
        return [[{ id: 21, site_id: 1, plan_name: "Plan", start_week: "2026-03-30", status: "APPROVED" }]];
      }
      if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
      if (sql.includes("INSERT INTO search_documents")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  pool.getConnection = async () => conn;

  const { server, baseUrl } = await startServer();
  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/planning/adjustments/88/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    }),
    fetch(`${baseUrl}/api/planning/adjustments/88/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    })
  ]);
  const statuses = [resA.status, resB.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
  pool.getConnection = originalGetConnection;
});

test("GET /api/dashboard scopes planner widgets to own site", async () => {
  const token = jwt.sign({ sub: 30, sessionId: "sess-dashboard-planner" }, config.jwtSecret, { expiresIn: 3600 });
  let siteScoped = false;

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-dashboard-planner",
        user_id: 30,
        last_activity_at: new Date(),
        username: "planner1",
        role: "PLANNER",
        site_id: 9,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("JOIN production_plans pp")) {
      siteScoped = params?.[0] === 9;
      return [[{ count: 4 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.role, "PLANNER");
  assert.equal(body.widgets.activeWorkOrders, 4);
  assert.equal(siteScoped, true);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("GET /api/dashboard returns generic error body for internal failures", async () => {
  const token = jwt.sign({ sub: 31, sessionId: "sess-dashboard-error" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-dashboard-error",
        user_id: 31,
        last_activity_at: new Date(),
        username: "admin",
        role: "ADMIN",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 1,
        has_sensitive_permission: 1
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("SELECT COUNT(*) AS count FROM work_orders")) {
      throw new Error("SQL INTERNAL DETAILS SHOULD NOT LEAK");
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error, "Internal server error");
  assert.equal(body.details, null);
  assert.equal(String(body.error).includes("SQL INTERNAL DETAILS"), false);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/notifications/offline-queue creates queued connector export", async () => {
  const token = jwt.sign({ sub: 32, sessionId: "sess-offline-create" }, config.jwtSecret, { expiresIn: 3600 });
  let queueInsertSeen = false;

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-offline-create",
        user_id: 32,
        last_activity_at: new Date(),
        username: "admin",
        role: "ADMIN",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 1,
        has_sensitive_permission: 1
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("INSERT INTO message_queue")) {
      queueInsertSeen = true;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/notifications/offline-queue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      channel: "EMAIL",
      recipient: "ops@example.local",
      subject: "Queue test",
      body: "offline payload"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(queueInsertSeen, true);
  assert.ok(body.id);
  assert.ok(String(body.filePath).includes("message_exports"));

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/notifications/offline-queue rejects unsupported channel", async () => {
  const token = jwt.sign({ sub: 37, sessionId: "sess-offline-unsupported" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-offline-unsupported",
        user_id: 37,
        last_activity_at: new Date(),
        username: "admin",
        role: "ADMIN",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 1,
        has_sensitive_permission: 1
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/notifications/offline-queue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      channel: "FAX",
      recipient: "ops@example.local",
      subject: "Unsupported",
      body: "payload"
    })
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Unsupported connector channel/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("POST /api/notifications/offline-queue/retry processes retries and statuses", async () => {
  const token = jwt.sign({ sub: 33, sessionId: "sess-offline-retry" }, config.jwtSecret, { expiresIn: 3600 });
  const retriedIds = [];

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-offline-retry",
        user_id: 33,
        last_activity_at: new Date(),
        username: "admin",
        role: "ADMIN",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 1,
        has_sensitive_permission: 1
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM message_queue WHERE status IN ('FAILED', 'QUEUED')")) {
      return [[
        { id: "msg-1", channel: "EMAIL", retry_count: 0 },
        { id: "msg-2", channel: "SMS", retry_count: 2 }
      ]];
    }
    if (sql.includes("UPDATE message_queue")) {
      retriedIds.push(params[2]);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/notifications/offline-queue/retry`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.processed, 2);
  assert.deepEqual(retriedIds, ["msg-1", "msg-2"]);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("receipt document upload and list works for same-site clerk", async () => {
  const token = jwt.sign({ sub: 40, sessionId: "sess-receipt-doc" }, config.jwtSecret, { expiresIn: 3600 });
  let uploadedId = "doc-1";

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-receipt-doc",
        user_id: 40,
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
    if (sql.includes("FROM receipts") && sql.includes("WHERE id = ?")) {
      return [[{ id: 501, site_id: 1, po_number: "PO-501" }]];
    }
    if (sql.includes("INSERT INTO receipt_documents")) {
      uploadedId = params[0];
      assert.equal(params[4], "B-9");
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO search_documents")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM receipt_documents")) {
      return [[{
        id: uploadedId,
        receipt_id: 501,
        po_line_no: "10",
        lot_no: "L1",
        batch_no: "B-9",
        storage_location_id: 9,
        title: "BOL",
        original_name: "doc.png",
        mime_type: "image/png",
        size_bytes: 512,
        uploaded_by: 40,
        created_at: new Date()
      }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const formData = new FormData();
  formData.append("file", new File(["x"], "doc.png", { type: "image/png" }));
  formData.append("poLineNo", "10");
  formData.append("lotNo", "L1");
  formData.append("batchNo", "B-9");
  formData.append("storageLocationId", "9");
  formData.append("title", "BOL");

  const uploadRes = await fetch(`${baseUrl}/api/receiving/receipts/501/documents`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: formData
  });
  const uploadBody = await uploadRes.json();
  assert.equal(uploadRes.status, 200);
  assert.ok(uploadBody.id);

  const listRes = await fetch(`${baseUrl}/api/receiving/receipts/501/documents`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const listBody = await listRes.json();
  assert.equal(listRes.status, 200);
  assert.equal(Array.isArray(listBody), true);
  assert.equal(listBody.length, 1);
  assert.equal(listBody[0].batch_no, "B-9");

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("GET /api/notifications returns user-scoped notification inbox", async () => {
  const token = jwt.sign({ sub: 41, sessionId: "sess-notif-list" }, config.jwtSecret, { expiresIn: 3600 });
  let scopedByUser = false;

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-notif-list",
        user_id: 41,
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
    if (sql.includes("FROM notifications") && sql.includes("LIMIT")) {
      scopedByUser = params.includes(41);
      return [[{ id: 1, user_id: 41, event_type: "RECEIPT_ACK", message: "x", status: "DELIVERED", deliver_after: null, delivered_at: new Date(), created_at: new Date() }]];
    }
    if (sql.includes("SELECT COUNT(*) AS total") && sql.includes("FROM notifications")) {
      return [[{ total: 1 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/notifications?page=1&pageSize=20`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.data.length, 1);
  assert.equal(scopedByUser, true);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("GET /api/audit is denied for user without AUDIT_READ", async () => {
  const token = jwt.sign({ sub: 42, sessionId: "sess-audit-deny" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-audit-deny",
        user_id: 42,
        last_activity_at: new Date(),
        username: "hr-no-audit",
        role: "HR",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM role_permissions rp")) return [[]];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/audit`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 403);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("GET /api/audit returns masked audit shape when sensitive permission absent", async () => {
  const token = jwt.sign({ sub: 43, sessionId: "sess-audit-admin" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-audit-admin",
        user_id: 43,
        last_activity_at: new Date(),
        username: "admin",
        role: "ADMIN",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM audit_logs") && sql.includes("LIMIT")) {
      return [[{
        id: 1,
        actor_user_id: 99,
        action: "UPDATE",
        entity_type: "candidate",
        entity_id: "5",
        before_value: { dob: "1990-01-01", ssnLast4: "1234" },
        after_value: { dob: "1991-01-01", ssnLast4: "4321" },
        created_at: new Date()
      }]];
    }
    if (sql.includes("SELECT COUNT(*) AS total") && sql.includes("FROM audit_logs")) {
      return [[{ total: 1 }]];
    }
    if (sql.includes("FROM role_permissions rp")) {
      return [[{ 1: 1 }]];
    }
    throw new Error(`Unexpected SQL: ${sql} params=${JSON.stringify(params)}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/audit?page=1&pageSize=20`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].beforeValue.dob, "[MASKED]");
  assert.equal(body.data[0].afterValue.ssnLast4, "[MASKED]");

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});
