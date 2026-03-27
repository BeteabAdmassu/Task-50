import Router from "koa-router";
import { enforceAttributeRule, requireAuth, requirePermission } from "../middleware/auth.js";
import {
  approvePlanAdjustment,
  createWorkOrder,
  logWorkOrderEvent,
  requestPlanAdjustment,
  runMrp,
  upsertMpsPlan
} from "../services/planning-service.js";

const router = new Router({ prefix: "/api/planning" });

router.post(
  "/mps",
  requireAuth,
  requirePermission("MPS_WRITE"),
  enforceAttributeRule((user, ctx) => user.role === "ADMIN" || Number(user.siteId) === Number(ctx.request.body.siteId)),
  async (ctx) => {
    ctx.body = await upsertMpsPlan(ctx.request.body, ctx.state.user);
  }
);

router.get("/mps/:planId/mrp", requireAuth, requirePermission("MRP_RUN"), async (ctx) => {
  ctx.body = await runMrp(ctx.params.planId, ctx.state.user);
});

router.post("/work-orders", requireAuth, requirePermission("WORK_ORDER_WRITE"), async (ctx) => {
  ctx.body = await createWorkOrder(ctx.request.body, ctx.state.user);
});

router.post(
  "/work-orders/:id/events",
  requireAuth,
  requirePermission("WORK_ORDER_WRITE"),
  async (ctx) => {
    await logWorkOrderEvent(ctx.params.id, ctx.request.body, ctx.state.user);
    ctx.body = { ok: true };
  }
);

router.post(
  "/plans/:planId/adjustments",
  requireAuth,
  requirePermission("PLAN_ADJUST"),
  async (ctx) => {
    ctx.body = await requestPlanAdjustment(ctx.params.planId, ctx.request.body, ctx.state.user);
  }
);

router.post(
  "/adjustments/:id/approve",
  requireAuth,
  requirePermission("PLAN_APPROVE"),
  async (ctx) => {
    ctx.body = await approvePlanAdjustment(ctx.params.id, ctx.state.user);
  }
);

export default router;
