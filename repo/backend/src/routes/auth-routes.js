import Router from "koa-router";
import { requireAuth, requireRoles } from "../middleware/auth.js";
import { createUser, login, logout } from "../services/auth-service.js";

const router = new Router({ prefix: "/api/auth" });

const loginRateWindowMs = 15 * 60 * 1000;
const loginRateLimitMax = 20;
const loginRateBuckets = new Map();

function loginRateBucketKey(ctx) {
  const ip = ctx.ip || "unknown";
  const username = String(ctx.request.body?.username || "").trim().toLowerCase() || "unknown";
  return `${ip}:${username}`;
}

function pruneExpiredLoginBuckets(now) {
  if (loginRateBuckets.size < 2000) return;
  for (const [key, bucket] of loginRateBuckets) {
    if (bucket.resetAt <= now) {
      loginRateBuckets.delete(key);
    }
  }
}

async function loginRateLimit(ctx, next) {
  const now = Date.now();
  pruneExpiredLoginBuckets(now);

  const key = loginRateBucketKey(ctx);
  const existing = loginRateBuckets.get(key);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + loginRateWindowMs }
    : existing;

  if (bucket.count >= loginRateLimitMax) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    ctx.set("Retry-After", String(retryAfterSeconds));
    ctx.status = 429;
    ctx.body = {
      error: "Too many login attempts. Please try again later.",
      details: null
    };
    return;
  }

  bucket.count += 1;
  loginRateBuckets.set(key, bucket);
  await next();
}

router.post("/login", loginRateLimit, async (ctx) => {
  const { username, password } = ctx.request.body;
  ctx.body = await login(username, password);
});

router.post("/logout", requireAuth, async (ctx) => {
  await logout(ctx.state.user.sessionId, ctx.state.user.id);
  ctx.body = { ok: true };
});

router.post("/users", requireAuth, requireRoles(["ADMIN"]), async (ctx) => {
  ctx.body = await createUser(ctx.request.body, ctx.state.user.id);
});

router.get("/me", requireAuth, async (ctx) => {
  ctx.body = { user: ctx.state.user };
});

export default router;
