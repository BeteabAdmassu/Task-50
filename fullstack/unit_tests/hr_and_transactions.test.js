import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createCandidateApplication, attachCandidateFile } from "../backend/src/services/hr-service.js";
import { encryptString } from "../backend/src/utils/crypto.js";
import { pool, withTx } from "../backend/src/db.js";

const originalExecute = pool.execute;
const originalGetConnection = pool.getConnection;

test("createCandidateApplication flags duplicate when name + dob + ssn4 match", async () => {
  const dob = "1990-01-01";
  const ssnLast4 = "1234";

  pool.execute = async (sql) => {
    if (sql.includes("FROM application_form_fields")) {
      return [[{ field_key: "work_eligibility" }]];
    }
    if (sql.includes("FROM candidates WHERE full_name")) {
      return [[{ id: 7, dob_enc: encryptString(dob), ssn_last4_enc: encryptString(ssnLast4) }]];
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
        return [{ insertId: 17 }];
      }
      if (sql.includes("INSERT INTO candidate_form_answers")) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes("FROM application_attachment_requirements")) {
        return [[{ classification: "RESUME" }]];
      }
      if (sql.includes("FROM candidate_attachments")) {
        return [[]];
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
      fullName: "Jane Doe",
      dob,
      ssnLast4,
      formData: [{ fieldKey: "work_eligibility", fieldValue: "yes" }]
    },
    null
  );
  assert.equal(result.duplicateFlag, true);

  pool.execute = originalExecute;
  pool.getConnection = originalGetConnection;
});

test("attachCandidateFile rejects invalid MIME type", async () => {
  await assert.rejects(
    () =>
      attachCandidateFile(1, {
        type: "text/plain",
        path: "C:/tmp/f.txt",
        name: "file.txt",
        size: 100
      }, null),
    /Only PDF\/JPG\/PNG allowed/
  );
});

test("attachCandidateFile rejects payload larger than 20MB", async () => {
  await assert.rejects(
    () =>
      attachCandidateFile(1, {
        type: "application/pdf",
        path: "C:/tmp/f.pdf",
        name: "file.pdf",
        size: 20 * 1024 * 1024 + 1
      }, null),
    /File exceeds 20 MB/
  );
});

test("withTx rolls back transaction when handler throws", async () => {
  const flags = { began: false, committed: false, rolledBack: false, released: false };
  const conn = {
    async beginTransaction() {
      flags.began = true;
    },
    async commit() {
      flags.committed = true;
    },
    async rollback() {
      flags.rolledBack = true;
    },
    release() {
      flags.released = true;
    }
  };
  pool.getConnection = async () => conn;

  await assert.rejects(
    () => withTx(async () => {
      throw new Error("forced failure");
    }),
    /forced failure/
  );

  assert.equal(flags.began, true);
  assert.equal(flags.committed, false);
  assert.equal(flags.rolledBack, true);
  assert.equal(flags.released, true);

  pool.getConnection = originalGetConnection;
});

test("schema contains immutable audit triggers for update and delete", async () => {
  const schemaPath = path.resolve(process.cwd(), "backend", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  assert.match(schemaSql, /CREATE TRIGGER trg_audit_logs_no_update/);
  assert.match(schemaSql, /CREATE TRIGGER trg_audit_logs_no_delete/);
  assert.match(schemaSql, /audit_logs is immutable/);
});
