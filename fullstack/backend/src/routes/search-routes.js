import Router from "koa-router";
import { requireAuth } from "../middleware/auth.js";
import { searchHub } from "../services/search-service.js";

const router = new Router({ prefix: "/api/search" });

router.get("/", requireAuth, async (ctx) => {
  ctx.body = await searchHub({
    actor: ctx.state.user,
    query: ctx.query.q,
    startDate: ctx.query.startDate,
    endDate: ctx.query.endDate,
    source: ctx.query.source,
    topic: ctx.query.topic,
    entityType: ctx.query.entityType
  });
});

export default router;
