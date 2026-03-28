import test from "node:test";
import assert from "node:assert/strict";
import { errorHandler } from "../backend/src/middleware/error-handler.js";
import { logger } from "../backend/src/utils/logger.js";

test("errorHandler does not log raw internal error message for 500", async () => {
  const originalError = logger.error;
  const captured = [];
  logger.error = (category, message, meta) => {
    captured.push({ category, message, meta });
  };

  const ctx = {
    path: "/api/dashboard",
    method: "GET",
    state: { correlationId: "corr-123" },
    get(name) {
      if (name === "x-correlation-id") return "header-corr";
      return "";
    }
  };

  await errorHandler(ctx, async () => {
    throw new Error("SQL INTERNAL DETAILS SHOULD NOT LEAK");
  });

  assert.equal(ctx.status, 500);
  assert.equal(ctx.body.error, "Internal server error");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].category, "system");
  assert.equal(captured[0].message, "Unhandled system error");
  assert.equal(captured[0].meta.path, "/api/dashboard");
  assert.equal(captured[0].meta.method, "GET");
  assert.equal(captured[0].meta.errorType, "Error");
  assert.equal(captured[0].meta.errorCode, null);
  assert.equal(captured[0].meta.correlationId, "corr-123");
  assert.equal("message" in captured[0].meta, false);

  logger.error = originalError;
});
