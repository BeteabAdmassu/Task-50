import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export async function errorHandler(ctx, next) {
  try {
    await next();
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    ctx.status = status;
    ctx.body = {
      error: err.message || "Unexpected error",
      details: err instanceof AppError ? err.details : null
    };
    if (status === 400) {
      logger.warn("validation", "Request validation failed", {
        path: ctx.path,
        method: ctx.method,
        status,
        message: err.message
      });
      return;
    }
    if (status === 401 || status === 403) {
      logger.warn("authorization", "Authorization/authentication error", {
        path: ctx.path,
        method: ctx.method,
        status,
        message: err.message,
        userId: ctx.state?.user?.id || null
      });
      return;
    }
    if (status >= 500) {
      logger.error("system", "Unhandled system error", {
        path: ctx.path,
        method: ctx.method,
        status,
        message: err.message,
        name: err.name
      });
    }
  }
}
