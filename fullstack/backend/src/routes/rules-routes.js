import Router from "koa-router";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  backtrackRecalculate,
  createRuleVersion,
  scoreQualification
} from "../services/rules-service.js";

const router = new Router({ prefix: "/api/rules" });

router.post("/versions", requireAuth, requirePermission("RULES_WRITE"), async (ctx) => {
  ctx.body = await createRuleVersion(ctx.request.body, ctx.state.user);
});

router.post("/score", requireAuth, requirePermission("RULES_SCORE"), async (ctx) => {
  ctx.body = await scoreQualification(ctx.request.body, ctx.state.user);
});

router.post(
  "/versions/:id/recalculate",
  requireAuth,
  requirePermission("RULES_WRITE"),
  async (ctx) => {
    ctx.body = await backtrackRecalculate(ctx.params.id, ctx.state.user);
  }
);

export default router;
