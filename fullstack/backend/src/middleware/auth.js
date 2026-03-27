import jwt from "jsonwebtoken";
import dayjs from "dayjs";
import { pool } from "../db.js";
import { config } from "../config.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { writeAudit } from "../services/audit-service.js";

export async function optionalAuth(ctx, next) {
  const authHeader = ctx.headers.authorization;
  if (!authHeader) return next();
  try {
    const token = authHeader.replace("Bearer ", "");
    const payload = jwt.verify(token, config.jwtSecret);
    const [rows] = await pool.execute(
      `SELECT s.id, s.user_id, s.last_activity_at, u.username, u.role, u.site_id,
              u.department_id, u.sensitive_data_view,
              EXISTS(
                SELECT 1
                FROM role_permissions rp
                JOIN permissions p ON p.id = rp.permission_id
                WHERE rp.role_code = u.role AND p.code = 'SENSITIVE_DATA_VIEW'
              ) AS has_sensitive_permission
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.revoked_at IS NULL`,
      [payload.sessionId]
    );
    if (!rows.length) return next();
    const session = rows[0];
    const idle = dayjs().diff(dayjs(session.last_activity_at), "second");
    if (idle > config.idleTimeoutSeconds) {
      await pool.execute("UPDATE sessions SET revoked_at = NOW() WHERE id = ?", [session.id]);
      await writeAudit({
        actorUserId: session.user_id,
        action: "UPDATE",
        entityType: "session",
        entityId: session.id,
        beforeValue: { revokedAt: null, lastActivityAt: session.last_activity_at },
        afterValue: { revokedAt: "NOW", reason: "IDLE_TIMEOUT" }
      });
      logger.info("auth", "Session revoked due to idle timeout", {
        userId: session.user_id,
        sessionId: session.id
      });
      return next();
    }
    await pool.execute("UPDATE sessions SET last_activity_at = NOW() WHERE id = ?", [session.id]);
    await writeAudit({
      actorUserId: session.user_id,
      action: "UPDATE",
      entityType: "session",
      entityId: session.id,
      beforeValue: { lastActivityAt: session.last_activity_at },
      afterValue: { lastActivityAt: "NOW" }
    });
    ctx.state.user = {
      id: session.user_id,
      username: session.username,
      role: session.role,
      siteId: session.site_id,
      departmentId: session.department_id,
      sensitiveDataView: Boolean(session.has_sensitive_permission),
      sessionId: session.id
    };
  } catch {
    logger.warn("auth", "Invalid token during optional auth", {});
  }
  await next();
}

export async function requireAuth(ctx, next) {
  await optionalAuth(ctx, async () => {});
  if (!ctx.state.user) {
    logger.warn("auth", "Authentication required", {
      path: ctx.path,
      method: ctx.method
    });
    throw new AppError(401, "Authentication required");
  }
  await next();
}

export function requireRoles(roles) {
  return async (ctx, next) => {
    if (!ctx.state.user || !roles.includes(ctx.state.user.role)) {
      logger.warn("authorization", "Role check denied", {
        path: ctx.path,
        method: ctx.method,
        userId: ctx.state.user?.id || null,
        role: ctx.state.user?.role || null,
        requiredRoles: roles
      });
      throw new AppError(403, "Insufficient role");
    }
    await next();
  };
}

export function requirePermission(permissionCode) {
  return async (ctx, next) => {
    const user = ctx.state.user;
    if (!user) {
      throw new AppError(401, "Authentication required");
    }
    if (user.role === "ADMIN") return next();

    const [rows] = await pool.execute(
      `SELECT 1
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_code = ? AND p.code = ? LIMIT 1`,
      [user.role, permissionCode]
    );
    if (!rows.length) {
      logger.warn("authorization", "Permission check denied", {
        path: ctx.path,
        method: ctx.method,
        userId: user.id,
        role: user.role,
        permissionCode
      });
      throw new AppError(403, `Permission missing: ${permissionCode}`);
    }
    await next();
  };
}

export function enforceAttributeRule(ruleHandler) {
  return async (ctx, next) => {
    const permitted = await ruleHandler(ctx.state.user, ctx);
    if (!permitted) {
      logger.warn("authorization", "Attribute rule denied", {
        path: ctx.path,
        method: ctx.method,
        userId: ctx.state.user?.id || null,
        role: ctx.state.user?.role || null
      });
      throw new AppError(403, "Attribute rule prevented this action");
    }
    await next();
  };
}
