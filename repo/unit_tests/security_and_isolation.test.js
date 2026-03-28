import test from "node:test";
import assert from "node:assert/strict";
import { createWorkOrder, logWorkOrderEvent, runMrp } from "../backend/src/services/planning-service.js";
import { searchHub } from "../backend/src/services/search-service.js";
import { publishEvent, queueOfflineMessage, subscribeNotification } from "../backend/src/services/notification-service.js";
import { optionalAuth } from "../backend/src/middleware/auth.js";
import { pool } from "../backend/src/db.js";
import { config } from "../backend/src/config.js";
import jwt from "../backend/node_modules/jsonwebtoken/index.js";

const originalExecute = pool.execute;

test("planning runMrp denies planner cross-site access", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM production_plans") && sql.includes("WHERE id = ?")) {
      return [[{ id: 10, site_id: 2, plan_name: "P", start_week: "2026-03-30", status: "DRAFT" }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await assert.rejects(
    () => runMrp(10, { id: 1, role: "PLANNER", siteId: 1 }),
    /Cannot access production plan for another site/
  );

  pool.execute = originalExecute;
});

test("planning runMrp allows same-site planner", async () => {
  let step = 0;
  pool.execute = async (sql) => {
    step += 1;
    if (step === 1 && sql.includes("FROM production_plans") && sql.includes("WHERE id = ?")) {
      return [[{ id: 10, site_id: 1, plan_name: "P", start_week: "2026-03-30", status: "DRAFT" }]];
    }
    if (sql.includes("FROM production_plan_lines")) {
      return [[{ item_code: "FG-1", total_qty: 100 }]];
    }
    if (sql.includes("FROM bill_of_materials")) {
      return [[{ component_code: "RM-1", qty_per: 2 }]];
    }
    if (sql.includes("FROM inventory_locations")) {
      return [[{ on_hand: 120 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const result = await runMrp(10, { id: 1, role: "PLANNER", siteId: 1 });
  assert.equal(result.length, 1);
  assert.equal(result[0].shortageQty, 80);

  pool.execute = originalExecute;
});

test("planning createWorkOrder denies cross-site plan", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM production_plans") && sql.includes("WHERE id = ?")) {
      return [[{ id: 42, site_id: 4, plan_name: "P", start_week: "2026-03-30", status: "DRAFT" }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await assert.rejects(
    () =>
      createWorkOrder(
        { planId: 42, itemCode: "FG", qtyTarget: 10, scheduledStart: null, scheduledEnd: null },
        { id: 1, role: "PLANNER", siteId: 1 }
      ),
    /Cannot access production plan for another site/
  );

  pool.execute = originalExecute;
});

test("planning logWorkOrderEvent denies cross-site work order", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM work_orders wo")) {
      return [[{ id: 50, plan_id: 70, site_id: 2 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await assert.rejects(
    () =>
      logWorkOrderEvent(
        50,
        { eventType: "PRODUCTION", qty: 5, reasonCode: null, notes: null },
        { id: 1, role: "PLANNER", siteId: 1 }
      ),
    /Cannot access work order for another site/
  );

  pool.execute = originalExecute;
});

test("planning logWorkOrderEvent rejects downtime without reason code", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM work_orders wo")) {
      return [[{ id: 50, plan_id: 70, site_id: 1 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await assert.rejects(
    () =>
      logWorkOrderEvent(
        50,
        { eventType: "DOWNTIME", qty: 0, reasonCode: "", notes: null },
        { id: 1, role: "PLANNER", siteId: 1 }
      ),
    /Downtime requires reason code/
  );

  pool.execute = originalExecute;
});

test("searchHub applies site scope for clerk", async () => {
  let scoped = false;
  pool.execute = async (sql, params) => {
    if (sql.includes("FROM search_documents")) {
      scoped = sql.includes("entity_type = 'receipt'") && params.includes(7);
      return [[]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await searchHub({
    actor: { id: 2, role: "CLERK", siteId: 7 },
    query: "receipt",
    startDate: null,
    endDate: null,
    source: null,
    topic: null,
    entityType: null
  });
  assert.equal(scoped, true);

  pool.execute = originalExecute;
});

test("optionalAuth derives sensitiveDataView from explicit permission", async () => {
  const token = jwt.sign({ sub: 2, sessionId: "s-sensitive" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "s-sensitive",
        user_id: 2,
        last_activity_at: new Date(),
        username: "hr1",
        role: "HR",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 0,
        has_sensitive_permission: 1
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const ctx = { headers: { authorization: `Bearer ${token}` }, state: {} };
  await optionalAuth(ctx, async () => {});
  assert.equal(ctx.state.user.sensitiveDataView, true);

  pool.execute = originalExecute;
});

test("optionalAuth does not grant sensitiveDataView from user flag alone", async () => {
  const token = jwt.sign({ sub: 3, sessionId: "s-flag-only" }, config.jwtSecret, { expiresIn: 3600 });

  pool.execute = async (sql) => {
    if (sql.includes("FROM sessions s")) {
      return [[{
        id: "s-flag-only",
        user_id: 3,
        last_activity_at: new Date(),
        username: "hr-flag",
        role: "HR",
        site_id: 1,
        department_id: 1,
        sensitive_data_view: 1,
        has_sensitive_permission: 0
      }]];
    }
    if (sql.includes("SET last_activity_at = NOW()")) {
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const ctx = { headers: { authorization: `Bearer ${token}` }, state: {} };
  await optionalAuth(ctx, async () => {});
  assert.equal(ctx.state.user.sensitiveDataView, false);

  pool.execute = originalExecute;
});

test("notification scheduling uses next valid daily and DND boundaries", async () => {
  const scheduled = [];
  pool.execute = async (sql, params) => {
    if (sql.includes("FROM notification_subscriptions")) {
      return [[{ user_id: 9, frequency: "DAILY", body_template: "x", dnd_start: "21:00", dnd_end: "07:00" }]];
    }
    if (sql.includes("INSERT INTO notifications")) {
      scheduled.push(params[3]);
      return [{ insertId: 1 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const firstNow = new Date("2026-03-27T18:30:00");
  await publishEvent("RECEIPT_ACK", {}, { id: 1 }, firstNow);
  const firstScheduled = new Date(scheduled[0]);
  assert.ok(firstScheduled.getTime() > firstNow.getTime());
  assert.equal(firstScheduled.getMinutes(), 0);
  assert.equal(firstScheduled.getSeconds(), 0);
  assert.equal(firstScheduled.getHours(), 18);

  scheduled.length = 0;
  pool.execute = async (sql, params) => {
    if (sql.includes("FROM notification_subscriptions")) {
      return [[{ user_id: 9, frequency: "IMMEDIATE", body_template: "x", dnd_start: "21:00", dnd_end: "07:00" }]];
    }
    if (sql.includes("INSERT INTO notifications")) {
      scheduled.push(params[3]);
      return [{ insertId: 2 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const secondNow = new Date("2026-03-27T06:30:00");
  await publishEvent("RECEIPT_ACK", {}, { id: 1 }, secondNow);
  const secondScheduled = new Date(scheduled[0]);
  assert.ok(secondScheduled.getTime() > secondNow.getTime());
  assert.equal(secondScheduled.getMinutes(), 0);
  assert.equal(secondScheduled.getSeconds(), 0);
  assert.equal(secondScheduled.getHours(), 7);

  pool.execute = originalExecute;
});

test("notification scheduling honors custom subscription DND window", async () => {
  const scheduled = [];
  pool.execute = async (sql, params) => {
    if (sql.includes("FROM notification_subscriptions")) {
      return [[{ user_id: 9, frequency: "IMMEDIATE", body_template: "x", dnd_start: "20:00", dnd_end: "06:00" }]];
    }
    if (sql.includes("INSERT INTO notifications")) {
      scheduled.push(params[3]);
      return [{ insertId: 1 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const now = new Date("2026-03-27T20:15:00");
  await publishEvent("RECEIPT_ACK", {}, { id: 1 }, now);
  const scheduledDate = new Date(scheduled[0]);
  assert.equal(scheduledDate.getHours(), 6);
  assert.equal(scheduledDate.getMinutes(), 0);
  assert.ok(scheduledDate.getTime() > now.getTime());

  pool.execute = originalExecute;
});

test("subscribeNotification rejects unsupported frequency", async () => {
  await assert.rejects(
    () =>
      subscribeNotification(
        { topic: "RECEIPT_ACK", frequency: "WEEKLY", dndStart: "21:00", dndEnd: "07:00" },
        { id: 9 }
      ),
    /Frequency must be one of IMMEDIATE, HOURLY, DAILY/
  );
});

test("queueOfflineMessage rejects unsupported connector channel", async () => {
  await assert.rejects(
    () =>
      queueOfflineMessage(
        {
          channel: "FAX",
          recipient: "ops@example.local",
          subject: "bad",
          body: "bad"
        },
        { id: 1 }
      ),
    /Unsupported connector channel/
  );
});

test("notification scheduling supports same-day DND window", async () => {
  const scheduled = [];
  pool.execute = async (sql, params) => {
    if (sql.includes("FROM notification_subscriptions")) {
      return [[{ user_id: 9, frequency: "IMMEDIATE", body_template: "x", dnd_start: "13:00", dnd_end: "17:00" }]];
    }
    if (sql.includes("INSERT INTO notifications") && sql.includes("deliver_after")) {
      scheduled.push(params[3]);
      return [{ insertId: 1 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const now = new Date("2026-03-27T14:15:00");
  await publishEvent("RECEIPT_ACK", {}, { id: 1 }, now);
  const scheduledDate = new Date(scheduled[0]);
  assert.equal(scheduledDate.getHours(), 17);
  assert.equal(scheduledDate.getMinutes(), 0);
  assert.ok(scheduledDate.getTime() > now.getTime());

  pool.execute = originalExecute;
});

test("searchHub supports typo tolerance and source filter", async () => {
  let capturedParams = [];
  let capturedSql = "";
  pool.execute = async (sql, params) => {
    if (sql.includes("FROM search_documents")) {
      capturedSql = sql;
      capturedParams = params;
      return [[
        {
          entity_type: "candidate",
          entity_id: "10",
          title: "Applicant profile",
          body: "Candidate onboarding",
          tags: "applicant,hr",
          source: "PORTAL",
          topic: "ONBOARD",
          created_at: new Date()
        }
      ]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const results = await searchHub({
    actor: { id: 1, role: "ADMIN", siteId: 1 },
    query: "aplicant",
    source: "PORTAL",
    topic: null,
    entityType: null,
    startDate: null,
    endDate: null
  });
  assert.equal(results.length, 1);
  assert.match(capturedSql, /MATCH\(title, body, tags\) AGAINST \(\? IN BOOLEAN MODE\)/);
  assert.ok(capturedParams.includes("PORTAL"));

  pool.execute = originalExecute;
});

test("searchHub enforces result cap boundary for empty query", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM search_documents")) {
      const rows = Array.from({ length: 150 }, (_, index) => ({
        entity_type: "candidate",
        entity_id: String(index + 1),
        title: `Candidate ${index + 1}`,
        body: "body",
        tags: "tag",
        source: "PORTAL",
        topic: "APPLICANT",
        created_at: new Date(Date.now() - index * 1000)
      }));
      return [rows];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const results = await searchHub({
    actor: { id: 1, role: "ADMIN", siteId: 1 },
    query: "",
    startDate: null,
    endDate: null,
    source: null,
    topic: null,
    entityType: null
  });

  assert.equal(results.length, 100);

  pool.execute = originalExecute;
});

test("searchHub applies filter boundaries in generated query params", async () => {
  let capturedSql = "";
  let capturedParams = [];
  pool.execute = async (sql, params) => {
    if (sql.includes("FROM search_documents")) {
      capturedSql = sql;
      capturedParams = params;
      return [[{
        entity_type: "candidate",
        entity_id: "9",
        title: "Applicant profile",
        body: "Candidate onboarding",
        tags: "applicant,hr",
        source: "PORTAL",
        topic: "APPLICANT",
        created_at: new Date()
      }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const results = await searchHub({
    actor: { id: 1, role: "ADMIN", siteId: 1 },
    query: "candidate",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    source: "PORTAL",
    topic: "APPLICANT",
    entityType: "candidate"
  });

  assert.equal(results.length, 1);
  assert.ok(capturedSql.includes("created_at >= ?"));
  assert.ok(capturedSql.includes("created_at <= ?"));
  assert.ok(capturedSql.includes("source = ?"));
  assert.ok(capturedSql.includes("topic = ?"));
  assert.ok(capturedSql.includes("entity_type = ?"));
  assert.ok(capturedParams.includes("2026-01-01"));
  assert.ok(capturedParams.includes("2026-12-31"));
  assert.ok(capturedParams.includes("PORTAL"));
  assert.ok(capturedParams.includes("APPLICANT"));
  assert.ok(capturedParams.includes("candidate"));

  pool.execute = originalExecute;
});
