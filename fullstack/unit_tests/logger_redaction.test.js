import test from "node:test";
import assert from "node:assert/strict";
import { logger } from "../backend/src/utils/logger.js";

test("logger redacts DOB variants in keys and values", () => {
  const originalLog = console.log;
  let line = "";
  console.log = (entry) => {
    line = entry;
  };

  logger.info("security", "date of birth leaked", {
    dob: "1990-01-01",
    dateOfBirth: "1991-02-02",
    date_of_birth: "1992-03-03",
    birthDate: "1993-04-04",
    candidateNote: "DOB: 1994-05-05",
    normalField: "safe"
  });

  console.log = originalLog;

  const payload = JSON.parse(line);
  assert.equal(payload.message, "[REDACTED]");
  assert.equal(payload.dob, "[REDACTED]");
  assert.equal(payload.dateOfBirth, "[REDACTED]");
  assert.equal(payload.date_of_birth, "[REDACTED]");
  assert.equal(payload.birthDate, "[REDACTED]");
  assert.equal(payload.candidateNote, "[REDACTED]");
  assert.equal(payload.normalField, "safe");
});

test("logger keeps existing credential redaction", () => {
  const originalWarn = console.warn;
  let line = "";
  console.warn = (entry) => {
    line = entry;
  };

  logger.warn("auth", "token leaked", {
    password: "secret",
    authorization: "Bearer abc",
    details: "ssn: 1234"
  });

  console.warn = originalWarn;

  const payload = JSON.parse(line);
  assert.equal(payload.message, "[REDACTED]");
  assert.equal(payload.password, "[REDACTED]");
  assert.equal(payload.authorization, "[REDACTED]");
  assert.equal(payload.details, "[REDACTED]");
});
