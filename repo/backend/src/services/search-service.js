import { pool } from "../db.js";

const synonyms = {
  applicant: ["candidate", "application"],
  receipt: ["inbound", "receiving"],
  workorder: ["wo", "job"],
  note: ["comment", "memo"]
};

function expandTerms(query) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const expanded = new Set(terms);
  for (const term of terms) {
    for (const [root, values] of Object.entries(synonyms)) {
      if (term === root || values.includes(term)) {
        expanded.add(root);
        values.forEach((value) => expanded.add(value));
      }
    }
  }
  return [...expanded];
}

function applyActorScope(actor, where, values) {
  if (!actor) {
    where.push("1=0");
    return;
  }
  if (actor.role === "ADMIN") {
    return;
  }

  if (actor.role === "CLERK") {
    where.push(`(
      (entity_type = 'receipt' AND EXISTS (
        SELECT 1 FROM receipts r
        WHERE r.id = CAST(search_documents.entity_id AS UNSIGNED)
          AND r.site_id = ?
      ))
    )`);
    values.push(actor.siteId);
    return;
  }

  if (["PLANNER", "PLANNER_SUPERVISOR"].includes(actor.role)) {
    where.push(`(
      (entity_type = 'work_order' AND EXISTS (
        SELECT 1
        FROM work_orders wo
        JOIN production_plans pp ON pp.id = wo.plan_id
        WHERE wo.id = CAST(search_documents.entity_id AS UNSIGNED)
          AND pp.site_id = ?
      ))
      OR
      (entity_type = 'production_plan' AND EXISTS (
        SELECT 1 FROM production_plans pp
        WHERE pp.id = CAST(search_documents.entity_id AS UNSIGNED)
          AND pp.site_id = ?
      ))
      OR
      (entity_type = 'plan_adjustment' AND EXISTS (
        SELECT 1
        FROM plan_adjustments pa
        JOIN production_plans pp ON pp.id = pa.plan_id
        WHERE pa.id = CAST(search_documents.entity_id AS UNSIGNED)
          AND pp.site_id = ?
      ))
    )`);
    values.push(actor.siteId, actor.siteId, actor.siteId);
    return;
  }

  if (actor.role === "HR") {
    where.push("entity_type = 'candidate'");
    return;
  }

  if (actor.role === "INTERVIEWER") {
    where.push(`(
      entity_type = 'candidate' AND EXISTS (
        SELECT 1
        FROM interviewer_candidate_assignments ica
        WHERE ica.candidate_id = CAST(search_documents.entity_id AS UNSIGNED)
          AND ica.interviewer_user_id = ?
      )
    )`);
    values.push(actor.id);
    return;
  }

  where.push("1=0");
}

export async function searchHub({ actor, query, startDate, endDate, source, topic, entityType }) {
  const terms = expandTerms(query || "");
  const likePredicates = terms.map(() => "(title LIKE ? OR body LIKE ? OR tags LIKE ?)").join(" OR ");
  const booleanQuery = terms.map((term) => `${term}*`).join(" ");
  const values = [];
  const searchPredicates = [];
  if (terms.length) {
    searchPredicates.push("MATCH(title, body, tags) AGAINST (? IN BOOLEAN MODE)");
    values.push(booleanQuery);
  }
  for (const term of terms) {
    values.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  if (likePredicates) {
    searchPredicates.push(likePredicates);
  }

  const where = [searchPredicates.length ? `(${searchPredicates.join(" OR ")})` : "1=1"];
  if (startDate) {
    where.push("created_at >= ?");
    values.push(startDate);
  }
  if (endDate) {
    where.push("created_at <= ?");
    values.push(endDate);
  }
  if (source) {
    where.push("source = ?");
    values.push(source);
  }
  if (topic) {
    where.push("topic = ?");
    values.push(topic);
  }
  if (entityType) {
    where.push("entity_type = ?");
    values.push(entityType);
  }

  applyActorScope(actor, where, values);

  const [rows] = await pool.execute(
    `SELECT entity_type, entity_id, title, body, tags, source, topic, created_at
     FROM search_documents
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 400`,
    values
  );

  if (!terms.length) {
    return rows.slice(0, 100);
  }

  return rows
    .map((row) => ({ row, score: rankRow(row, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 100)
    .map((item) => item.row);
}

function rankRow(row, terms) {
  const haystack = `${row.title || ""} ${row.body || ""} ${row.tags || ""}`.toLowerCase();
  const words = new Set(haystack.split(/[^a-z0-9]+/).filter(Boolean));
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (haystack.includes(term)) {
      score += 5;
      continue;
    }
    for (const word of words) {
      if (levenshtein(term, word) <= 1) {
        score += 2;
        break;
      }
    }
  }
  return score;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}
