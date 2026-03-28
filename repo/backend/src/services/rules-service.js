import { pool, withTx } from "../db.js";
import { AppError, assert } from "../utils/errors.js";
import { writeAudit } from "./audit-service.js";

const defaultWeights = {
  coursework: 0.4,
  midterm: 0.2,
  final: 0.4
};

function toGpa(score) {
  if (score >= 93) return 4.0;
  if (score >= 90) return 3.7;
  if (score >= 87) return 3.3;
  if (score >= 83) return 3.0;
  if (score >= 80) return 2.7;
  if (score >= 77) return 2.3;
  if (score >= 73) return 2.0;
  if (score >= 70) return 1.7;
  if (score >= 67) return 1.3;
  if (score >= 65) return 1.0;
  return 0;
}

export async function createRuleVersion(input, actor) {
  const weights = input.weights || defaultWeights;
  assert(Math.abs(weights.coursework + weights.midterm + weights.final - 1) < 0.001, 400, "Weights must total 1");

  return withTx(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO scoring_rule_versions
        (version_name, weights_json, retake_policy, effective_date, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.versionName,
        JSON.stringify(weights),
        input.retakePolicy || "HIGHEST_SCORE",
        input.effectiveDate,
        actor.id
      ]
    );
    await writeAudit({
      actorUserId: actor.id,
      action: "CREATE",
      entityType: "scoring_rule_version",
      entityId: result.insertId,
      beforeValue: null,
      afterValue: {
        versionName: input.versionName,
        weights,
        retakePolicy: input.retakePolicy || "HIGHEST_SCORE",
        effectiveDate: input.effectiveDate
      },
      conn
    });

    const markedForRecalc = await markScoresForRecalc(result.insertId, actor, conn, {
      failWhenEmpty: false,
      auditRuleVersion: true,
      auditPayload: { autoRecalculateTriggered: true }
    });

    return { id: result.insertId, markedForRecalc };
  });
}

export async function scoreQualification(input, actor) {
  const [[rule]] = await pool.execute(
    `SELECT id, weights_json, retake_policy
     FROM scoring_rule_versions
     WHERE id = ?`,
    [input.ruleVersionId]
  );
  assert(rule, 404, "Rule version not found");
  const weights = JSON.parse(rule.weights_json);

  const coursework = chooseScore(input.courseworkScores || [], rule.retake_policy);
  const midterm = chooseScore(input.midtermScores || [], rule.retake_policy);
  const final = chooseScore(input.finalScores || [], rule.retake_policy);

  const weightedFinal =
    coursework * weights.coursework + midterm * weights.midterm + final * weights.final;
  const gpa = toGpa(weightedFinal);
  const qualityPoints = gpa * (input.creditHours || 0);

  const [result] = await pool.execute(
    `INSERT INTO qualification_scores
      (candidate_id, rule_version_id, coursework_score, midterm_score, final_score,
       weighted_score, gpa, credit_hours, quality_points)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.candidateId,
      input.ruleVersionId,
      coursework,
      midterm,
      final,
      weightedFinal,
      gpa,
      input.creditHours,
      qualityPoints
    ]
  );

  await writeAudit({
    actorUserId: actor.id,
    action: "CREATE",
    entityType: "qualification_score",
    entityId: result.insertId,
    beforeValue: null,
    afterValue: {
      candidateId: input.candidateId,
      ruleVersionId: input.ruleVersionId,
      weightedFinal,
      gpa,
      qualityPoints
    }
  });

  return {
    scoreId: result.insertId,
    weightedFinal,
    gpa,
    qualityPoints
  };
}

function chooseScore(scores, policy) {
  if (!scores.length) return 0;
  if (policy === "HIGHEST_SCORE") {
    return Math.max(...scores.map(Number));
  }
  return Number(scores[scores.length - 1]);
}

export async function backtrackRecalculate(ruleVersionId, actor) {
  return withTx(async (conn) => {
    const markedForRecalc = await markScoresForRecalc(ruleVersionId, actor, conn, {
      failWhenEmpty: true,
      auditRuleVersion: true,
      auditPayload: { recalculationRequested: true }
    });
    return { markedForRecalc };
  });
}

async function markScoresForRecalc(ruleVersionId, actor, conn, options) {
  const [rows] = await conn.execute(
    `SELECT id, candidate_id, credit_hours
     FROM qualification_scores
     WHERE rule_version_id = ?`,
    [ruleVersionId]
  );
  if (!rows.length && options.failWhenEmpty) {
    throw new AppError(404, "No scores found for rule version");
  }

  for (const row of rows) {
    await conn.execute(
      `UPDATE qualification_scores
       SET recalculation_pending = 1
       WHERE id = ?`,
      [row.id]
    );
    await writeAudit({
      actorUserId: actor.id,
      action: "UPDATE",
      entityType: "qualification_score",
      entityId: row.id,
      beforeValue: { recalculationPending: false, ruleVersionId: Number(ruleVersionId) },
      afterValue: { recalculationPending: true, ruleVersionId: Number(ruleVersionId) },
      conn
    });
  }

  if (options.auditRuleVersion) {
    await writeAudit({
      actorUserId: actor.id,
      action: "UPDATE",
      entityType: "scoring_rule_version",
      entityId: ruleVersionId,
      beforeValue: { recalculationRequested: false },
      afterValue: {
        ...options.auditPayload,
        affectedScores: rows.length
      },
      conn
    });
  }

  return rows.length;
}
