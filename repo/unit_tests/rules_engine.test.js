import test from "node:test";
import assert from "node:assert/strict";
import {
  backtrackRecalculate,
  createRuleVersion,
  scoreQualification
} from "../backend/src/services/rules-service.js";
import { pool } from "../backend/src/db.js";

const originalExecute = pool.execute;
const originalGetConnection = pool.getConnection;

test("createRuleVersion persists weights and writes audit", async () => {
  let auditCount = 0;
  let selectSeen = false;
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes("INSERT INTO scoring_rule_versions")) {
        return [{ insertId: 5 }];
      }
      if (sql.includes("FROM qualification_scores")) {
        selectSeen = true;
        return [[]];
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        auditCount += 1;
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  pool.getConnection = async () => conn;

  const result = await createRuleVersion(
    {
      versionName: "v1",
      weights: { coursework: 0.4, midterm: 0.2, final: 0.4 },
      effectiveDate: "2026-04-01"
    },
    { id: 10 }
  );
  assert.equal(result.id, 5);
  assert.equal(result.markedForRecalc, 0);
  assert.equal(selectSeen, true);
  assert.equal(auditCount >= 2, true);

  pool.getConnection = originalGetConnection;
});

test("scoreQualification applies highest-score policy and GPA conversion", async () => {
  let capturedInsert = null;
  pool.execute = async (sql, params) => {
    if (sql.includes("FROM scoring_rule_versions")) {
      return [[{ id: 1, weights_json: JSON.stringify({ coursework: 0.4, midterm: 0.2, final: 0.4 }), retake_policy: "HIGHEST_SCORE" }]];
    }
    if (sql.includes("INSERT INTO qualification_scores")) {
      capturedInsert = params;
      return [{ insertId: 88 }];
    }
    if (sql.includes("INSERT INTO audit_logs")) {
      return [{ insertId: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };

  const result = await scoreQualification(
    {
      candidateId: 9,
      ruleVersionId: 1,
      courseworkScores: [70, 88],
      midtermScores: [70],
      finalScores: [92, 85],
      creditHours: 3
    },
    { id: 1 }
  );

  assert.equal(result.scoreId, 88);
  assert.equal(Number(capturedInsert[2]), 88);
  assert.equal(Number(capturedInsert[3]), 70);
  assert.equal(Number(capturedInsert[4]), 92);
  assert.equal(result.gpa > 0, true);

  pool.execute = originalExecute;
});

test("backtrackRecalculate marks all records pending and audits updates", async () => {
  let updateCount = 0;
  let auditCount = 0;
  const conn = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes("FROM qualification_scores")) {
        return [[{ id: 1 }, { id: 2 }]];
      }
      if (sql.includes("UPDATE qualification_scores")) {
        updateCount += 1;
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        auditCount += 1;
        return [{ insertId: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  pool.getConnection = async () => conn;

  const result = await backtrackRecalculate(3, { id: 1 });
  assert.equal(result.markedForRecalc, 2);
  assert.equal(updateCount, 2);
  assert.equal(auditCount >= 3, true);

  pool.getConnection = originalGetConnection;
});
