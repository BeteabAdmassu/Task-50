import Koa from "koa";
import Router from "koa-router";
import cors from "@koa/cors";
import { koaBody } from "koa-body";
import { errorHandler } from "./middleware/error-handler.js";
import authRoutes from "./routes/auth-routes.js";
import receivingRoutes from "./routes/receiving-routes.js";
import planningRoutes from "./routes/planning-routes.js";
import hrRoutes from "./routes/hr-routes.js";
import notificationRoutes from "./routes/notification-routes.js";
import searchRoutes from "./routes/search-routes.js";
import rulesRoutes from "./routes/rules-routes.js";
import { requireAuth } from "./middleware/auth.js";
import { pool } from "./db.js";

const app = new Koa();
const router = new Router();

app.use(errorHandler);
app.use(cors());
app.use(
  koaBody({
    multipart: true,
    formidable: {
      maxFileSize: 20 * 1024 * 1024,
      multiples: false
    }
  })
);

router.get("/api/health", async (ctx) => {
  ctx.body = { ok: true };
});

router.get("/api/dashboard", requireAuth, async (ctx) => {
  const role = ctx.state.user.role;
  if (role === "CLERK") {
    const [[openReceipts]] = await pool.execute(
      "SELECT COUNT(*) AS count FROM receipts WHERE status = 'OPEN' AND site_id = ?",
      [ctx.state.user.siteId]
    );
    ctx.body = { role, widgets: { openReceipts: openReceipts.count } };
    return;
  }
  if (role === "PLANNER") {
    const [[openOrders]] = await pool.execute(
      "SELECT COUNT(*) AS count FROM work_orders WHERE status IN ('OPEN', 'IN_PROGRESS')"
    );
    ctx.body = { role, widgets: { activeWorkOrders: openOrders.count } };
    return;
  }
  const [[candidateCount]] = await pool.execute("SELECT COUNT(*) AS count FROM candidates");
  ctx.body = { role, widgets: { candidates: candidateCount.count } };
});

app.use(router.routes());
app.use(router.allowedMethods());

app.use(authRoutes.routes());
app.use(authRoutes.allowedMethods());
app.use(receivingRoutes.routes());
app.use(receivingRoutes.allowedMethods());
app.use(planningRoutes.routes());
app.use(planningRoutes.allowedMethods());
app.use(hrRoutes.routes());
app.use(hrRoutes.allowedMethods());
app.use(notificationRoutes.routes());
app.use(notificationRoutes.allowedMethods());
app.use(searchRoutes.routes());
app.use(searchRoutes.allowedMethods());
app.use(rulesRoutes.routes());
app.use(rulesRoutes.allowedMethods());

export default app;
