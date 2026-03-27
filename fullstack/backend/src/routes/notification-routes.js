import Router from "koa-router";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  processPendingNotifications,
  publishEvent,
  queueOfflineMessage,
  retryFailedMessages,
  subscribeNotification
} from "../services/notification-service.js";

const router = new Router({ prefix: "/api/notifications" });

router.post("/subscriptions", requireAuth, async (ctx) => {
  ctx.body = await subscribeNotification(ctx.request.body, ctx.state.user);
});

router.post("/events", requireAuth, requirePermission("NOTIFY_PUBLISH"), async (ctx) => {
  ctx.body = await publishEvent(
    ctx.request.body.eventType,
    ctx.request.body.payload || {},
    ctx.state.user
  );
});

router.post("/dispatch", requireAuth, requirePermission("NOTIFY_PUBLISH"), async (ctx) => {
  ctx.body = await processPendingNotifications(ctx.state.user);
});

router.post("/offline-queue", requireAuth, requirePermission("MESSAGE_QUEUE"), async (ctx) => {
  ctx.body = await queueOfflineMessage(ctx.request.body, ctx.state.user);
});

router.post("/offline-queue/retry", requireAuth, requirePermission("MESSAGE_QUEUE"), async (ctx) => {
  ctx.body = await retryFailedMessages(ctx.state.user);
});

export default router;
