import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "../backend/node_modules/bcryptjs/index.js";
import jwt from "../backend/node_modules/jsonwebtoken/index.js";
import { login } from "../backend/src/services/auth-service.js";
import { optionalAuth, requirePermission } from "../backend/src/middleware/auth.js";
import { pool } from "../backend/src/db.js";
import { config } from "../backend/src/config.js";

const originalExecute = pool.execute;

test("login locks account after fifth failed attempt", async () => {
  const hash = await bcrypt.hash("CorrectPassword123", 4);
  let updateParams = null;

  pool.execute = async (sql, params) => {
    if (sql.includes("FROM users WHERE username = ?")) {
      return [[{
        id: 10,
        username: "clerk1",
        role: "CLERK",
        password_hash: hash,
        failed_login_attempts: 4,
        locked_until: null,
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0
      }]];
    }
    if (sql.includes("SET failed_login_attempts = ?")) {
      updateParams = params;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await assert.rejects(() => login("clerk1", "WrongPassword123"), /Invalid username or password/);
  assert.equal(updateParams[0], 5);
  assert.equal(updateParams[2], 10);
  assert.ok(updateParams[1] instanceof Date);

  pool.execute = originalExecute;
});

test("login returns token and resets failed attempts on success", async () => {
  const hash = await bcrypt.hash("CorrectPassword123", 4);
  let resetAttempts = false;
  let sessionInsert = false;
  let auditInsert = false;

  pool.execute = async (sql, params) => {
    if (sql.includes("FROM users WHERE username = ?")) {
      return [[{
        id: 11,
        username: "planner1",
        role: "PLANNER",
        password_hash: hash,
        failed_login_attempts: 0,
        locked_until: null,
        site_id: 1,
        department_id: 2,
        sensitive_data_view: 0
      }]];
    }
    if (sql.includes("failed_login_attempts = 0")) {
      resetAttempts = true;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO sessions")) {
      sessionInsert = true;
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      auditInsert = true;
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const result = await login("planner1", "CorrectPassword123");
  assert.ok(result.token);
  assert.equal(result.user.role, "PLANNER");
  assert.equal(resetAttempts, true);
  assert.equal(sessionInsert, true);
  assert.equal(auditInsert, true);

  pool.execute = originalExecute;
});

test("optionalAuth revokes idle session after timeout", async () => {
  const token = jwt.sign({ sub: 1, sessionId: "session-1" }, config.jwtSecret, { expiresIn: 3600 });
  let revoked = false;
  const staleDate = new Date(Date.now() - 31 * 60 * 1000);

  pool.execute = async (sql) => {
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "session-1",
        user_id: 1,
        last_activity_at: staleDate,
        username: "admin",
        role: "ADMIN",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 1
      }]];
    }
    if (sql.includes("SET revoked_at = NOW()")) {
      revoked = true;
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const ctx = { headers: { authorization: `Bearer ${token}` }, state: {} };
  await optionalAuth(ctx, async () => {});
  assert.equal(revoked, true);
  assert.equal(ctx.state.user, undefined);

  pool.execute = originalExecute;
});

test("requirePermission blocks user without mapped permission", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM role_permissions rp")) {
      return [[]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const middleware = requirePermission("RECEIPT_CLOSE");
  const ctx = {
    state: {
      user: {
        id: 12,
        role: "CLERK"
      }
    }
  };

  await assert.rejects(() => middleware(ctx, async () => {}), /Permission missing: RECEIPT_CLOSE/);

  pool.execute = originalExecute;
});
