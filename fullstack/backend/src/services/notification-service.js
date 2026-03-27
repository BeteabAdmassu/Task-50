import fs from "node:fs/promises";
import path from "node:path";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../db.js";
import { config } from "../config.js";
import { writeAudit } from "./audit-service.js";

const dndStart = "21:00";
const dndEnd = "07:00";

function inDoNotDisturb(now = dayjs()) {
  const hhmm = now.format("HH:mm");
  return hhmm >= dndStart || hhmm < dndEnd;
}

export async function subscribeNotification(input, actor) {
  const [existing] = await pool.execute(
    `SELECT id, frequency, enabled FROM notification_subscriptions
     WHERE user_id = ? AND topic = ?`,
    [actor.id, input.topic]
  );
  
  const beforeValue = existing.length ? {
    frequency: existing[0].frequency,
    enabled: Boolean(existing[0].enabled)
  } : null;
  
  const [result] = await pool.execute(
    `INSERT INTO notification_subscriptions
      (user_id, topic, frequency, enabled)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE frequency = VALUES(frequency), enabled = 1`,
    [actor.id, input.topic, input.frequency]
  );
  
  const subscriptionId = result.insertId || existing[0].id;
  const afterValue = {
    frequency: input.frequency,
    enabled: true
  };
  
  await writeAudit({
    actorUserId: actor.id,
    action: existing.length ? "UPDATE" : "CREATE",
    entityType: "notification_subscription",
    entityId: subscriptionId,
    beforeValue,
    afterValue
  });
  
  return { id: subscriptionId, ok: true };
}

export async function publishEvent(eventType, payload, actor = null) {
  const [subs] = await pool.execute(
    `SELECT ns.user_id, ns.frequency, nt.body_template
     FROM notification_subscriptions ns
     JOIN notification_templates nt ON nt.topic = ns.topic
     WHERE ns.topic = ? AND ns.enabled = 1`,
    [eventType]
  );
  const now = dayjs();
  let createdCount = 0;
  for (const sub of subs) {
    if (inDoNotDisturb(now)) {
      const [result] = await pool.execute(
        `INSERT INTO notifications
          (user_id, event_type, message, status, deliver_after)
         VALUES (?, ?, ?, 'PENDING', ?)`,
        [sub.user_id, eventType, renderTemplate(sub.body_template, payload), now.hour(7).add(1, "day").toDate()]
      );
      createdCount += 1;
      await writeAudit({
        actorUserId: actor?.id || null,
        action: "CREATE",
        entityType: "notification",
        entityId: result.insertId,
        beforeValue: null,
        afterValue: {
          userId: sub.user_id,
          eventType,
          status: "PENDING",
          mode: "DND"
        }
      });
      continue;
    }

    if (sub.frequency === "IMMEDIATE") {
      const [result] = await pool.execute(
        `INSERT INTO notifications
          (user_id, event_type, message, status, delivered_at)
         VALUES (?, ?, ?, 'DELIVERED', NOW())`,
        [sub.user_id, eventType, renderTemplate(sub.body_template, payload)]
      );
      createdCount += 1;
      await writeAudit({
        actorUserId: actor?.id || null,
        action: "CREATE",
        entityType: "notification",
        entityId: result.insertId,
        beforeValue: null,
        afterValue: {
          userId: sub.user_id,
          eventType,
          status: "DELIVERED",
          mode: "IMMEDIATE"
        }
      });
    } else {
      const deliverAfter =
        sub.frequency === "HOURLY"
          ? now.startOf("hour").add(1, "hour").toDate()
          : now.hour(18).minute(0).second(0).millisecond(0).toDate();
      const [result] = await pool.execute(
        `INSERT INTO notifications
          (user_id, event_type, message, status, deliver_after)
         VALUES (?, ?, ?, 'PENDING', ?)`,
        [sub.user_id, eventType, renderTemplate(sub.body_template, payload), deliverAfter]
      );
      createdCount += 1;
      await writeAudit({
        actorUserId: actor?.id || null,
        action: "CREATE",
        entityType: "notification",
        entityId: result.insertId,
        beforeValue: null,
        afterValue: {
          userId: sub.user_id,
          eventType,
          status: "PENDING",
          mode: sub.frequency
        }
      });
    }
  }
  return { created: createdCount };
}

export async function processPendingNotifications(actor = null) {
  const [rows] = await pool.execute(
    `SELECT id, status FROM notifications
     WHERE status = 'PENDING' AND deliver_after <= NOW()`
  );
  for (const row of rows) {
    await pool.execute(
      "UPDATE notifications SET status = 'DELIVERED', delivered_at = NOW() WHERE id = ?",
      [row.id]
    );
    await writeAudit({
      actorUserId: actor?.id || null,
      action: "UPDATE",
      entityType: "notification",
      entityId: row.id,
      beforeValue: { status: row.status },
      afterValue: { status: "DELIVERED" }
    });
  }
  return { delivered: rows.length };
}

function renderTemplate(template, payload) {
  return template.replace(/\{(\w+)\}/g, (_, key) => payload[key] ?? "");
}

export async function queueOfflineMessage(input, actor) {
  await fs.mkdir(config.exportDir, { recursive: true });
  const id = uuidv4();
  const fileName = `${dayjs().format("YYYYMMDD-HHmmss")}-${id}.json`;
  const filePath = path.join(config.exportDir, fileName);
  const content = {
    id,
    channel: input.channel,
    recipient: input.recipient,
    subject: input.subject,
    body: input.body,
    exportedAt: new Date().toISOString(),
    status: "QUEUED"
  };
  await fs.writeFile(filePath, JSON.stringify(content, null, 2), "utf8");
  await pool.execute(
    `INSERT INTO message_queue
      (id, channel, recipient, subject, body, status, export_file)
     VALUES (?, ?, ?, ?, ?, 'QUEUED', ?)`,
    [id, input.channel, input.recipient, input.subject, input.body, filePath]
  );
  
  await writeAudit({
    actorUserId: actor.id,
    action: "CREATE",
    entityType: "message_queue",
    entityId: id,
    beforeValue: null,
    afterValue: {
      channel: input.channel,
      recipient: input.recipient,
      subject: input.subject,
      status: "QUEUED"
    }
  });
  
  return { id, filePath };
}

export async function retryFailedMessages(actor = null) {
  const [rows] = await pool.execute(
    `SELECT id, retry_count
     FROM message_queue WHERE status IN ('FAILED', 'QUEUED')`
  );
  for (const row of rows) {
    const nextRetry = Number(row.retry_count) + 1;
    const nextStatus = nextRetry >= 3 ? "FAILED" : "QUEUED";
    await pool.execute(
      `UPDATE message_queue
       SET retry_count = retry_count + 1,
            status = CASE WHEN retry_count + 1 >= 3 THEN 'FAILED' ELSE 'QUEUED' END
       WHERE id = ?`,
      [row.id]
    );
    await writeAudit({
      actorUserId: actor?.id || null,
      action: "UPDATE",
      entityType: "message_queue",
      entityId: row.id,
      beforeValue: { retryCount: Number(row.retry_count) },
      afterValue: { retryCount: nextRetry, status: nextStatus }
    });
  }
  return { processed: rows.length };
}
