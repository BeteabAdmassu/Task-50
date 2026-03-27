import app from "./app.js";
import { config } from "./config.js";
import { processPendingNotifications, retryFailedMessages } from "./services/notification-service.js";
import { logger } from "./utils/logger.js";

app.listen(config.port, () => {
  logger.info("system", "ForgeOps backend started", { port: config.port });
});

setInterval(async () => {
  try {
    await processPendingNotifications();
    await retryFailedMessages();
  } catch (err) {
    logger.error("system", "Scheduler tick failed", { message: err.message });
  }
}, 60 * 1000);
