import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import jwt from "../backend/node_modules/jsonwebtoken/index.js";
import app from "../backend/src/app.js";
import { pool } from "../backend/src/db.js";
import { config } from "../backend/src/config.js";
import { encryptString } from "../backend/src/utils/crypto.js";

const originalExecute = pool.execute;

async function startServer() {
  const server = createServer(app.callback());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

test("planning API denies planner creating MPS for another site", async () => {
  const token = jwt.sign({ sub: 1, sessionId: "sess-plan-1" }, config.jwtSecret, { expiresIn: 3600 });
  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("INSERT INTO search_documents")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-plan-1",
        user_id: 1,
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
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const weeks = Array.from({ length: 12 }, (_, i) => ({ weekIndex: i + 1, itemCode: "FG-1", plannedQty: 10 }));
  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/planning/mps`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ siteId: 2, planName: "CrossSite", startWeek: "2026-03-30", weeks })
  });
  assert.equal(response.status, 403);
  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("planning API allows planner creating MPS for same site", async () => {
  const token = jwt.sign({ sub: 1, sessionId: "sess-plan-2" }, config.jwtSecret, { expiresIn: 3600 });
  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("INSERT INTO search_documents")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-plan-2",
        user_id: 1,
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
    if (sql.includes("SELECT id") && sql.includes("FROM production_plans")) return [[{ id: 61 }]];
    if (sql.includes("FROM production_plans") && sql.includes("start_week")) return [[]];
    if (sql.includes("INSERT INTO production_plans")) return [{ affectedRows: 1 }];
    if (sql.includes("INSERT INTO production_plan_lines")) return [{ affectedRows: 1 }];
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const weeks = Array.from({ length: 12 }, (_, i) => ({ weekIndex: i + 1, itemCode: "FG-1", plannedQty: 10 }));
  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/planning/mps`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ siteId: 1, planName: "SameSite", startWeek: "2026-03-30", weeks })
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.id, 61);
  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("interviewer can read assigned candidate but not unassigned", async () => {
  const token = jwt.sign({ sub: 8, sessionId: "sess-int-1" }, config.jwtSecret, { expiresIn: 3600 });
  const dobEnc = encryptString("1990-01-01");
  const ssnEnc = encryptString("1234");

  let assignmentAllowed = true;
  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-int-1",
        user_id: 8,
        last_activity_at: new Date(),
        username: "interviewer1",
        role: "INTERVIEWER",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM role_permissions rp")) return [[{ 1: 1 }]];
    if (sql.includes("FROM interviewer_candidate_assignments")) {
      return assignmentAllowed ? [[{ 1: 1 }]] : [[]];
    }
    if (sql.includes("FROM application_attachment_requirements")) {
      return [[{ classification: "RESUME" }, { classification: "IDENTITY_DOC" }]];
    }
    if (sql.includes("FROM candidate_attachments")) {
      return [[]];
    }
    if (sql.includes("FROM candidates WHERE id = ?")) {
      return [[{ id: 333, full_name: "A", email: "a@a", phone: "111", dob_enc: dobEnc, ssn_last4_enc: ssnEnc, duplicate_flag: 0, created_at: new Date() }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  let response = await fetch(`${baseUrl}/api/hr/candidates/333`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  const allowedBody = await response.json();
  assert.match(allowedBody.dob, /\*/);

  assignmentAllowed = false;
  response = await fetch(`${baseUrl}/api/hr/candidates/333`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 403);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("candidate attachment upload succeeds with candidate upload token", async () => {
  const uploadToken = jwt.sign(
    { purpose: "CANDIDATE_ATTACHMENT", candidateId: "201" },
    config.jwtSecret,
    { expiresIn: 3600 }
  );

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("INSERT INTO search_documents")) return [{ affectedRows: 1 }];
    if (sql.includes("SELECT id, source FROM candidates WHERE id = ?")) return [[{ id: 201, source: "PORTAL" }]];
    if (sql.includes("INSERT INTO candidate_attachments")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM application_attachment_requirements")) return [[{ classification: "RESUME" }]];
    if (sql.includes("FROM candidate_attachments")) return [[{ classification: "RESUME", count: 1 }]];
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const formData = new FormData();
  formData.append("file", new File(["png-bytes"], "resume.png", { type: "image/png" }));

  const response = await fetch(`${baseUrl}/api/hr/applications/201/attachments`, {
    method: "POST",
    headers: {
      "x-candidate-upload-token": uploadToken
    },
    body: formData
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(body.id);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("search endpoint applies clerk site isolation", async () => {
  const token = jwt.sign({ sub: 7, sessionId: "sess-search-1" }, config.jwtSecret, { expiresIn: 3600 });
  let scopeApplied = false;

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-search-1",
        user_id: 7,
        last_activity_at: new Date(),
        username: "clerk1",
        role: "CLERK",
        site_id: 5,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM search_documents")) {
      scopeApplied = sql.includes("entity_type = 'receipt'") && params.includes(5);
      return [[]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/search?q=receipt`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 200);
  assert.equal(scopeApplied, true);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("sensitive fields are unmasked when session has SENSITIVE_DATA_VIEW permission", async () => {
  const token = jwt.sign({ sub: 2, sessionId: "sess-hr-sensitive" }, config.jwtSecret, { expiresIn: 3600 });
  const dobEnc = encryptString("1992-09-11");
  const ssnEnc = encryptString("9988");

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-hr-sensitive",
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
    if (sql.includes("FROM application_attachment_requirements")) {
      return [[{ classification: "RESUME" }, { classification: "IDENTITY_DOC" }]];
    }
    if (sql.includes("FROM candidate_attachments")) {
      return [[{ classification: "RESUME", count: 1 }, { classification: "IDENTITY_DOC", count: 1 }]];
    }
    if (sql.includes("FROM candidates WHERE id = ?")) {
      return [[{ id: 9, full_name: "B", email: "b@b", phone: "222", dob_enc: dobEnc, ssn_last4_enc: ssnEnc, duplicate_flag: 0, created_at: new Date() }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/hr/candidates/9`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.dob, "1992-09-11");
  assert.equal(body.ssnLast4, "9988");

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("sensitive fields stay masked when user flag is true but permission is missing", async () => {
  const token = jwt.sign({ sub: 12, sessionId: "sess-flag-only" }, config.jwtSecret, { expiresIn: 3600 });
  const dobEnc = encryptString("1991-02-03");
  const ssnEnc = encryptString("1122");

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-flag-only",
        user_id: 12,
        last_activity_at: new Date(),
        username: "hr-flag-only",
        role: "HR",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 1,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) return [{ affectedRows: 1 }];
    if (sql.includes("FROM role_permissions rp")) return [[{ 1: 1 }]];
    if (sql.includes("FROM application_attachment_requirements")) {
      return [[{ classification: "RESUME" }]];
    }
    if (sql.includes("FROM candidate_attachments")) {
      return [[{ classification: "RESUME", count: 1 }]];
    }
    if (sql.includes("FROM candidates WHERE id = ?")) {
      return [[{ id: 120, full_name: "C", email: "c@c", phone: "333", dob_enc: dobEnc, ssn_last4_enc: ssnEnc, source: "PORTAL", duplicate_flag: 0, created_at: new Date() }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/hr/candidates/120`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(body.dob, /\*/);
  assert.match(body.ssnLast4, /\*/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("notification subscription accepts custom DND window", async () => {
  const token = jwt.sign({ sub: 2, sessionId: "sess-notify" }, config.jwtSecret, { expiresIn: 3600 });
  let dndPersisted = false;

  pool.execute = async (sql, params) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-notify",
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
    if (sql.includes("SELECT id, frequency, enabled, dnd_start, dnd_end")) return [[]];
    if (sql.includes("INSERT INTO notification_subscriptions")) {
      dndPersisted = params[3] === "20:30" && params[4] === "06:15";
      return [{ insertId: 22 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const { server, baseUrl } = await startServer();
  const response = await fetch(`${baseUrl}/api/notifications/subscriptions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic: "RECEIPT_ACK", frequency: "DAILY", dndStart: "20:30", dndEnd: "06:15" })
  });
  assert.equal(response.status, 200);
  assert.equal(dndPersisted, true);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});

test("notification subscription rejects unsupported frequency", async () => {
  const token = jwt.sign({ sub: 2, sessionId: "sess-notify-invalid-frequency" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "sess-notify-invalid-frequency",
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
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ topic: "RECEIPT_ACK", frequency: "WEEKLY", dndStart: "20:30", dndEnd: "06:15" })
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error, /Frequency must be one of IMMEDIATE, HOURLY, DAILY/);

  await new Promise((resolve) => server.close(resolve));
  pool.execute = originalExecute;
});
