import test from "node:test";
import assert from "node:assert/strict";
import {
  closeReceipt,
  recommendPutaway,
  scheduleDockAppointment
} from "../backend/src/services/receiving-service.js";
import { approvePlanAdjustment } from "../backend/src/services/planning-service.js";
import { createCandidateApplication } from "../backend/src/services/hr-service.js";
import { pool } from "../backend/src/db.js";

const originalExecute = pool.execute;
const originalGetConnection = pool.getConnection;

test("scheduleDockAppointment rejects double-booked slot", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM dock_appointments")) {
      return [[{ id: 77 }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await assert.rejects(
    () =>
      scheduleDockAppointment(
        {
          siteId: 1,
          poNumber: "PO-1",
          startAt: "2026-03-30T09:00:00.000Z",
          endAt: "2026-03-30T09:30:00.000Z"
        },
        { id: 5, role: "CLERK", siteId: 1 }
      ),
    /Time slot already booked/
  );

  pool.execute = originalExecute;
});

test("closeReceipt rejects qty mismatches without valid discrepancy record", async () => {
  let call = 0;
  pool.execute = async (sql) => {
    call += 1;
    if (call === 1 && sql.includes("FROM receipts WHERE id")) {
      return [[{ id: 9, site_id: 1, status: "OPEN", received_by: 4 }]];
    }
    if (call === 2 && sql.includes("FROM receipt_discrepancies")) {
      return [[]];
    }
    if (call === 3 && sql.includes("FROM receipt_lines rl")) {
      return [[{
        id: 1,
        po_line_no: "10",
        qty_expected: 100,
        qty_received: 95,
        qty_delta: -5,
        discrepancy_id: null,
        discrepancy_type: null,
        disposition_note: null
      }]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  await assert.rejects(
    () => closeReceipt(9, { id: 4, role: "CLERK", siteId: 1 }),
    /Quantity discrepancies require valid type and disposition note/
  );

  pool.execute = originalExecute;
});

test("recommendPutaway skips incompatible mixed storage and picks valid bin", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM inventory_locations")) {
      return [[
        {
          id: 1,
          code: "A-01",
          capacity_qty: 100,
          occupied_qty: 20,
          current_sku: "SKU-1",
          current_lot: "LOT-OLD"
        },
        {
          id: 2,
          code: "A-02",
          capacity_qty: 100,
          occupied_qty: 60,
          current_sku: "SKU-1",
          current_lot: "LOT-NEW"
        }
      ]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const result = await recommendPutaway({ sku: "SKU-1", lotNo: "LOT-NEW", quantity: 10 });
  assert.equal(result.locationId, 2);

  pool.execute = originalExecute;
});

test("approvePlanAdjustment applies after_snapshot updates and line upserts", async () => {
  let updatedPlan = false;
  let lineUpserts = 0;

  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes("FROM plan_adjustments WHERE id")) {
        return [[{
          id: 5,
          plan_id: 21,
          before_snapshot: JSON.stringify({ planName: "Old Plan" }),
          after_snapshot: JSON.stringify({
            planName: "New Plan",
            status: "APPROVED",
            weeks: [{ weekIndex: 1, itemCode: "ITEM-1", plannedQty: 150 }]
          }),
          status: "PENDING"
        }]];
      }
      if (sql.includes("FROM production_plans") && sql.includes("FOR UPDATE")) {
        return [[{ id: 21, site_id: 1, plan_name: "Old Plan", start_week: "2026-03-30", status: "DRAFT" }]];
      }
      if (sql.includes("UPDATE production_plans")) {
        updatedPlan = true;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO production_plan_lines")) {
        lineUpserts += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("UPDATE plan_adjustments")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        return [{ insertId: 1 }];
      }
      if (sql.includes("SELECT id, site_id, plan_name, start_week, status") && !sql.includes("FOR UPDATE")) {
        return [[{ id: 21, site_id: 1, plan_name: "New Plan", start_week: "2026-03-30", status: "APPROVED" }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };

  pool.getConnection = async () => conn;
  const result = await approvePlanAdjustment(5, { id: 2, role: "PLANNER_SUPERVISOR" });
  assert.equal(result.ok, true);
  assert.equal(updatedPlan, true);
  assert.equal(lineUpserts, 1);

  pool.getConnection = originalGetConnection;
});

test("createCandidateApplication returns upload token", async () => {
  pool.execute = async (sql) => {
    if (sql.includes("FROM application_form_fields")) {
      return [[{ field_key: "work_eligibility" }]];
    }
    if (sql.includes("FROM candidates WHERE full_name")) {
      return [[]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes("INSERT INTO candidates")) {
        return [{ insertId: 88 }];
      }
      if (sql.includes("INSERT INTO candidate_form_answers")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  pool.getConnection = async () => conn;

  const result = await createCandidateApplication(
    {
      fullName: "Jane Candidate",
      dob: "1995-05-01",
      ssnLast4: "1234",
      formData: [{ fieldKey: "work_eligibility", fieldValue: "yes" }]
    },
    null
  );

  assert.equal(result.id, 88);
  assert.equal(typeof result.uploadToken, "string");
  assert.ok(result.uploadToken.length > 10);

  pool.execute = originalExecute;
  pool.getConnection = originalGetConnection;
});
