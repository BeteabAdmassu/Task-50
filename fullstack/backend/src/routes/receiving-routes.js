import Router from "koa-router";
import { enforceAttributeRule, requireAuth, requirePermission } from "../middleware/auth.js";
import { pool } from "../db.js";
import {
  closeReceipt,
  createReceipt,
  recommendPutaway,
  scheduleDockAppointment
} from "../services/receiving-service.js";

const router = new Router({ prefix: "/api/receiving" });

router.post(
  "/dock-appointments",
  requireAuth,
  requirePermission("DOCK_APPOINTMENT_WRITE"),
  enforceAttributeRule((user, ctx) => user.role !== "CLERK" || user.siteId === ctx.request.body.siteId),
  async (ctx) => {
    ctx.body = await scheduleDockAppointment(ctx.request.body, ctx.state.user);
  }
);

router.post(
  "/receipts",
  requireAuth,
  requirePermission("RECEIPT_WRITE"),
  enforceAttributeRule((user, ctx) => user.role !== "CLERK" || user.siteId === ctx.request.body.siteId),
  async (ctx) => {
    ctx.body = await createReceipt(ctx.request.body, ctx.state.user);
  }
);

router.post(
  "/receipts/:id/close",
  requireAuth,
  requirePermission("RECEIPT_CLOSE"),
  enforceAttributeRule(async (user, ctx) => {
    if (["ADMIN", "PLANNER_SUPERVISOR"].includes(user.role)) return true;
    if (user.role !== "CLERK") return false;
    const [rows] = await pool.execute("SELECT site_id FROM receipts WHERE id = ?", [ctx.params.id]);
    if (!rows.length) return true;
    return Number(rows[0].site_id) === Number(user.siteId);
  }),
  async (ctx) => {
    await closeReceipt(ctx.params.id, ctx.state.user);
    ctx.body = { ok: true };
  }
);

router.post("/putaway/recommend", requireAuth, requirePermission("PUTAWAY_READ"), async (ctx) => {
  ctx.body = await recommendPutaway(ctx.request.body);
});

export default router;
