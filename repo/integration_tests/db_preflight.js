import { pool } from "../backend/src/db.js";

const setupSteps = [
  "1) Apply DB schema: backend/schema.sql",
  "2) Apply DB seed data: backend/seed.sql",
  "3) Seed users: node backend/scripts/seed-users.js"
].join("\n");

const requiredTables = [
  "users",
  "sessions",
  "receipts",
  "audit_logs",
  "notification_subscriptions",
  "notifications",
  "message_queue"
];

function preflightError(reason, details = "") {
  const detailText = details ? `\nDetails: ${details}` : "";
  return new Error(
    `[DB preflight failed] ${reason}${detailText}\n` +
      "Required setup:\n" +
      setupSteps
  );
}

export async function runDbPreflightChecks({ adminUsername, clerkUsername, verifyLogins }) {
  try {
    await pool.execute("SELECT 1 AS ok");
  } catch (err) {
    throw preflightError("Database connectivity check failed (SELECT 1).", err.message);
  }

  const [tableRows] = await pool.execute(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()`
  );
  const present = new Set(tableRows.map((row) => row.table_name));
  const missing = requiredTables.filter((name) => !present.has(name));
  if (missing.length) {
    throw preflightError("Required tables are missing.", `Missing: ${missing.join(", ")}`);
  }

  const [userRows] = await pool.execute(
    "SELECT username FROM users WHERE username IN (?, ?)",
    [adminUsername, clerkUsername]
  );
  const usersFound = new Set(userRows.map((row) => row.username));
  if (!usersFound.has(adminUsername) || !usersFound.has(clerkUsername)) {
    throw preflightError(
      "Seeded users are missing for integration checks.",
      `Expected users: ${adminUsername}, ${clerkUsername}`
    );
  }

  if (verifyLogins) {
    try {
      await verifyLogins();
    } catch (err) {
      throw preflightError(
        "Seeded user login verification failed.",
        err.message
      );
    }
  }
}

export function dbSetupSteps() {
  return setupSteps;
}
