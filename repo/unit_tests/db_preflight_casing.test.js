import test from "node:test";
import assert from "node:assert/strict";
import { extractTableName } from "../integration_tests/db_preflight.js";

test("extractTableName supports lowercase table_name key", () => {
  assert.equal(extractTableName({ table_name: "users" }), "users");
});

test("extractTableName supports uppercase TABLE_NAME key", () => {
  assert.equal(extractTableName({ TABLE_NAME: "sessions" }), "sessions");
});

test("extractTableName safely ignores mixed/invalid rows", () => {
  assert.equal(extractTableName({}), null);
  assert.equal(extractTableName({ table_name: "" }), null);
  assert.equal(extractTableName({ table_name: 123 }), null);
  assert.equal(extractTableName(null), null);
});
