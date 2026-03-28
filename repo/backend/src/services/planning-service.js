import { pool, withTx } from "../db.js";
import { AppError, assert } from "../utils/errors.js";
import { writeAudit } from "./audit-service.js";
import { archiveSearchDocument, upsertSearchDocument } from "./search-index-service.js";

function canCrossSite(actor) {
  return actor.role === "ADMIN";
}

function assertSiteAccess(actor, siteId, message = "Access denied for site") {
  if (!canCrossSite(actor) && Number(actor.siteId) !== Number(siteId)) {
    throw new AppError(403, message);
  }
}

async function getPlanWithAccess(planId, actor, conn = null) {
  const queryable = conn || pool;
  const [rows] = await queryable.execute(
    `SELECT id, site_id, plan_name, start_week, status
     FROM production_plans
     WHERE id = ?`,
    [planId]
  );
  assert(rows.length, 404, "Production plan not found");
  assertSiteAccess(actor, rows[0].site_id, "Cannot access production plan for another site");
  return rows[0];
}

async function getWorkOrderWithAccess(workOrderId, actor, conn = null) {
  const queryable = conn || pool;
  const [rows] = await queryable.execute(
    `SELECT wo.id, wo.plan_id, pp.site_id
     FROM work_orders wo
     JOIN production_plans pp ON pp.id = wo.plan_id
     WHERE wo.id = ?`,
    [workOrderId]
  );
  assert(rows.length, 404, "Work order not found");
  assertSiteAccess(actor, rows[0].site_id, "Cannot access work order for another site");
  return rows[0];
}

export async function upsertMpsPlan(input, actor) {
  assert(input.siteId, 400, "siteId is required");
  assert(Array.isArray(input.weeks) && input.weeks.length === 12, 400, "Exactly 12 weeks required");
  assertSiteAccess(actor, input.siteId, "Cannot create or update plans for another site");

  const [beforeRows] = await pool.execute(
    `SELECT id, site_id, plan_name, start_week, status
     FROM production_plans
     WHERE site_id = ? AND start_week = ?`,
    [input.siteId, input.startWeek]
  );
  const beforeValue = beforeRows.length ? beforeRows[0] : null;

  await pool.execute(
    `INSERT INTO production_plans
      (site_id, plan_name, start_week, status, created_by)
     VALUES (?, ?, ?, 'DRAFT', ?)
     ON DUPLICATE KEY UPDATE plan_name = VALUES(plan_name), updated_at = NOW()`,
    [input.siteId, input.planName, input.startWeek, actor.id]
  );

  const [[plan]] = await pool.execute(
    `SELECT id
     FROM production_plans
     WHERE site_id = ? AND start_week = ?`,
    [input.siteId, input.startWeek]
  );
  const planId = plan.id;
  for (const week of input.weeks) {
    await pool.execute(
      `INSERT INTO production_plan_lines
        (plan_id, week_index, item_code, planned_qty)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE planned_qty = VALUES(planned_qty)`,
      [planId, week.weekIndex, week.itemCode, week.plannedQty]
    );
  }

  await writeAudit({
    actorUserId: actor.id,
    action: beforeValue ? "UPDATE" : "CREATE",
    entityType: "production_plan",
    entityId: planId,
    beforeValue,
    afterValue: input
  });

  await upsertSearchDocument({
    entityType: "production_plan",
    entityId: planId,
    title: input.planName || `Plan ${planId}`,
    body: `12-week MPS starting ${input.startWeek}`,
    tags: ["mps", "production", `site-${input.siteId}`],
    source: "PLANNING",
    topic: "MPS"
  });
  return { id: planId };
}

export async function runMrp(planId, actor) {
  const plan = await getPlanWithAccess(planId, actor);
  const [planLines] = await pool.execute(
    `SELECT ppl.item_code, SUM(ppl.planned_qty) AS total_qty
     FROM production_plan_lines ppl
     WHERE ppl.plan_id = ?
     GROUP BY ppl.item_code`,
    [planId]
  );

  const requirements = [];
  for (const line of planLines) {
    const [bom] = await pool.execute(
      `SELECT component_code, qty_per
       FROM bill_of_materials
       WHERE parent_item_code = ?`,
      [line.item_code]
    );
    for (const comp of bom) {
      const required = Number(comp.qty_per) * Number(line.total_qty);
      const [[stock]] = await pool.execute(
        `SELECT COALESCE(SUM(occupied_qty), 0) AS on_hand
         FROM inventory_locations
         WHERE current_sku = ?
           AND site_id = ?`,
        [comp.component_code, plan.site_id]
      );
      requirements.push({
        componentCode: comp.component_code,
        requiredQty: required,
        onHandQty: Number(stock.on_hand),
        shortageQty: Math.max(0, required - Number(stock.on_hand))
      });
    }
  }
  return requirements;
}

export async function createWorkOrder(input, actor) {
  await getPlanWithAccess(input.planId, actor);
  const [result] = await pool.execute(
    `INSERT INTO work_orders
      (plan_id, item_code, qty_target, status, scheduled_start, scheduled_end, created_by)
     VALUES (?, ?, ?, 'OPEN', ?, ?, ?)`,
    [input.planId, input.itemCode, input.qtyTarget, input.scheduledStart, input.scheduledEnd, actor.id]
  );
  await writeAudit({
    actorUserId: actor.id,
    action: "CREATE",
    entityType: "work_order",
    entityId: result.insertId,
    beforeValue: null,
    afterValue: input
  });

  await upsertSearchDocument({
    entityType: "work_order",
    entityId: result.insertId,
    title: `Work Order ${result.insertId}`,
    body: `Item ${input.itemCode}, target ${input.qtyTarget}`,
    tags: ["workorder", input.itemCode],
    source: "PLANNING",
    topic: "WORK_ORDER"
  });
  return { id: result.insertId };
}

export async function logWorkOrderEvent(workOrderId, input, actor) {
  await getWorkOrderWithAccess(workOrderId, actor);
  assert(["PRODUCTION", "REWORK", "DOWNTIME"].includes(input.eventType), 400, "Invalid event type");
  if (input.eventType === "DOWNTIME") {
    assert(input.reasonCode, 400, "Downtime requires reason code");
  }
  await pool.execute(
    `INSERT INTO work_order_events
      (work_order_id, event_type, qty, reason_code, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [workOrderId, input.eventType, input.qty || 0, input.reasonCode || null, input.notes || null, actor.id]
  );
  await writeAudit({
    actorUserId: actor.id,
    action: "CREATE",
    entityType: "work_order_event",
    entityId: workOrderId,
    beforeValue: null,
    afterValue: input
  });

  await upsertSearchDocument({
    entityType: "note",
    entityId: `${workOrderId}-${Date.now()}`,
    title: `Work order event ${input.eventType}`,
    body: input.notes || "Work order event logged",
    tags: ["workorder", "event", input.eventType, input.reasonCode || ""],
    source: "PLANNING",
    topic: "WORK_ORDER_EVENT"
  });
}

export async function requestPlanAdjustment(planId, input, actor) {
  assert(input.reasonCode, 400, "Reason code required");
  await getPlanWithAccess(planId, actor);
  const [result] = await pool.execute(
    `INSERT INTO plan_adjustments
      (plan_id, reason_code, requested_by, status, before_snapshot, after_snapshot)
     VALUES (?, ?, ?, 'PENDING', ?, ?)`,
    [planId, input.reasonCode, actor.id, JSON.stringify(input.before), JSON.stringify(input.after)]
  );
  await writeAudit({
    actorUserId: actor.id,
    action: "UPDATE",
    entityType: "plan_adjustment",
    entityId: result.insertId,
    beforeValue: input.before,
    afterValue: input.after
  });

  await upsertSearchDocument({
    entityType: "plan_adjustment",
    entityId: result.insertId,
    title: `Plan Adjustment ${result.insertId}`,
    body: `Reason ${input.reasonCode}`,
    tags: ["plan", "adjustment", input.reasonCode],
    source: "PLANNING",
    topic: "ADJUSTMENT"
  });
  return { id: result.insertId };
}

export async function approvePlanAdjustment(adjustmentId, actor) {
  return withTx(async (conn) => {
    const [rows] = await conn.execute(
      `SELECT id, plan_id, before_snapshot, after_snapshot, status
       FROM plan_adjustments WHERE id = ? FOR UPDATE`,
      [adjustmentId]
    );
    assert(rows.length, 404, "Adjustment not found");
    const adj = rows[0];
    assert(adj.status === "PENDING", 409, "Adjustment is not pending");
    if (!["ADMIN", "PLANNER_SUPERVISOR"].includes(actor.role)) {
      throw new AppError(403, "Supervisor approval required");
    }

    const snapshot =
      typeof adj.after_snapshot === "string"
        ? JSON.parse(adj.after_snapshot)
        : adj.after_snapshot || {};

    const [planRows] = await conn.execute(
      `SELECT id, site_id, plan_name, start_week, status
       FROM production_plans
       WHERE id = ? FOR UPDATE`,
      [adj.plan_id]
    );
    assert(planRows.length, 404, "Production plan not found");
    const planBefore = planRows[0];
    assertSiteAccess(actor, planBefore.site_id, "Cannot approve adjustments for another site");

    if (
      snapshot.planName !== undefined ||
      snapshot.startWeek !== undefined ||
      snapshot.status !== undefined
    ) {
      await conn.execute(
        `UPDATE production_plans
         SET plan_name = COALESCE(?, plan_name),
             start_week = COALESCE(?, start_week),
             status = COALESCE(?, status),
             updated_at = NOW()
         WHERE id = ?`,
        [
          snapshot.planName ?? null,
          snapshot.startWeek ?? null,
          snapshot.status ?? null,
          adj.plan_id
        ]
      );
    }

    if (Array.isArray(snapshot.weeks)) {
      for (const week of snapshot.weeks) {
        assert(week.weekIndex != null, 400, "weekIndex required in adjustment snapshot");
        assert(week.itemCode, 400, "itemCode required in adjustment snapshot");
        assert(week.plannedQty != null, 400, "plannedQty required in adjustment snapshot");
        await conn.execute(
          `INSERT INTO production_plan_lines
            (plan_id, week_index, item_code, planned_qty)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE planned_qty = VALUES(planned_qty)`,
          [adj.plan_id, week.weekIndex, week.itemCode, week.plannedQty]
        );
      }
    }

    await conn.execute(
      `UPDATE plan_adjustments
       SET status = 'APPROVED', approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [actor.id, adjustmentId]
    );
    await writeAudit({
      actorUserId: actor.id,
      action: "APPROVE",
      entityType: "plan_adjustment",
      entityId: adjustmentId,
      beforeValue: {
        status: "PENDING",
        planId: adj.plan_id,
        beforeSnapshot:
          typeof adj.before_snapshot === "string"
            ? JSON.parse(adj.before_snapshot)
            : adj.before_snapshot
      },
      afterValue: {
        status: "APPROVED",
        planId: adj.plan_id,
        appliedSnapshot: snapshot
      },
      conn
    });

    const [planAfterRows] = await conn.execute(
      `SELECT id, site_id, plan_name, start_week, status
       FROM production_plans
       WHERE id = ?`,
      [adj.plan_id]
    );

    await writeAudit({
      actorUserId: actor.id,
      action: "UPDATE",
      entityType: "production_plan",
      entityId: adj.plan_id,
      beforeValue: planBefore,
      afterValue: planAfterRows[0],
      conn
    });

    if (planAfterRows[0]?.status === "ARCHIVED") {
      await archiveSearchDocument("production_plan", adj.plan_id, conn);
    } else {
      await upsertSearchDocument({
        entityType: "production_plan",
        entityId: adj.plan_id,
        title: planAfterRows[0].plan_name,
        body: `Plan status ${planAfterRows[0].status}`,
        tags: ["mps", "production", `site-${planAfterRows[0].site_id}`],
        source: "PLANNING",
        topic: "MPS"
      }, conn);
    }

    return { ok: true };
  });
}
