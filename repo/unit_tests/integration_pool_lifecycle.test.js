import test from "node:test";
import assert from "node:assert/strict";
import { createSuitePoolLifecycle } from "../integration_tests/pool-lifecycle.js";

test("integration pool lifecycle closes only after last suite release", async () => {
  let closeCount = 0;
  const lifecycle = createSuitePoolLifecycle(async () => {
    closeCount += 1;
  });

  const releaseA = lifecycle.acquireSuite();
  const releaseB = lifecycle.acquireSuite();

  await releaseA();
  assert.equal(closeCount, 0);
  assert.deepEqual(lifecycle.getState(), { activeSuites: 1, closed: false });

  await releaseB();
  assert.equal(closeCount, 1);
  assert.deepEqual(lifecycle.getState(), { activeSuites: 0, closed: true });
});

test("integration pool lifecycle release is idempotent", async () => {
  let closeCount = 0;
  const lifecycle = createSuitePoolLifecycle(async () => {
    closeCount += 1;
  });

  const release = lifecycle.acquireSuite();
  await release();
  await release();

  assert.equal(closeCount, 1);
  assert.deepEqual(lifecycle.getState(), { activeSuites: 0, closed: true });
});
