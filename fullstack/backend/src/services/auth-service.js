import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db.js";
import { config } from "../config.js";
import { AppError, assert } from "../utils/errors.js";
import { writeAudit } from "./audit-service.js";
import { logger } from "../utils/logger.js";

export async function login(username, password) {
  const [rows] = await pool.execute(
    `SELECT id, username, role, password_hash, failed_login_attempts, locked_until,
            site_id, department_id, sensitive_data_view
     FROM users WHERE username = ?`,
    [username]
  );
  if (!rows.length) throw new AppError(401, "Invalid username or password");

  const user = rows[0];
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    logger.warn("auth", "Login blocked due to account lock", { username });
    throw new AppError(423, "Account locked due to failed attempts");
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const beforeValue = {
      failedLoginAttempts: Number(user.failed_login_attempts || 0),
      lockedUntil: user.locked_until || null
    };
    const attempts = user.failed_login_attempts + 1;
    const lockedUntil =
      attempts >= config.maxFailedLogins
        ? new Date(Date.now() + config.accountLockMinutes * 60 * 1000)
        : null;
    await pool.execute(
      `UPDATE users
       SET failed_login_attempts = ?, locked_until = ?
       WHERE id = ?`,
      [attempts, lockedUntil, user.id]
    );
    await writeAudit({
      actorUserId: user.id,
      action: "UPDATE",
      entityType: "user",
      entityId: user.id,
      beforeValue,
      afterValue: {
        failedLoginAttempts: attempts,
        lockedUntil
      }
    });
    logger.warn("auth", "Invalid login attempt", {
      username,
      attempts,
      locked: Boolean(lockedUntil)
    });
    throw new AppError(401, "Invalid username or password");
  }

  await pool.execute(
    "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?",
    [user.id]
  );
  await writeAudit({
    actorUserId: user.id,
    action: "UPDATE",
    entityType: "user",
    entityId: user.id,
    beforeValue: {
      failedLoginAttempts: Number(user.failed_login_attempts || 0),
      lockedUntil: user.locked_until || null
    },
    afterValue: {
      failedLoginAttempts: 0,
      lockedUntil: null
    }
  });

  const sessionId = uuidv4();
  await pool.execute(
    `INSERT INTO sessions (id, user_id, issued_at, last_activity_at)
     VALUES (?, ?, NOW(), NOW())`,
    [sessionId, user.id]
  );

  const token = jwt.sign({ sub: user.id, sessionId }, config.jwtSecret, {
    expiresIn: config.jwtTtlSeconds
  });

  await writeAudit({
    actorUserId: user.id,
    action: "LOGIN",
    entityType: "session",
    entityId: sessionId,
    beforeValue: null,
    afterValue: { sessionId }
  });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      siteId: user.site_id,
      departmentId: user.department_id,
      sensitiveDataView: Boolean(user.sensitive_data_view)
    }
  };
}

export async function logout(sessionId, actorUserId) {
  await pool.execute("UPDATE sessions SET revoked_at = NOW() WHERE id = ?", [sessionId]);
  await writeAudit({
    actorUserId,
    action: "LOGOUT",
    entityType: "session",
    entityId: sessionId,
    beforeValue: null,
    afterValue: { revoked: true }
  });
}

export async function createUser(userInput, actorUserId) {
  assert(userInput.password && userInput.password.length >= 12, 400, "Password too short");
  const hash = await bcrypt.hash(userInput.password, 12);

  const [result] = await pool.execute(
    `INSERT INTO users
      (username, role, password_hash, site_id, department_id, sensitive_data_view)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userInput.username,
      userInput.role,
      hash,
      userInput.siteId || null,
      userInput.departmentId || null,
      userInput.sensitiveDataView ? 1 : 0
    ]
  );

  await writeAudit({
    actorUserId,
    action: "CREATE",
    entityType: "user",
    entityId: result.insertId,
    beforeValue: null,
    afterValue: {
      username: userInput.username,
      role: userInput.role
    }
  });

  return { id: result.insertId };
}
