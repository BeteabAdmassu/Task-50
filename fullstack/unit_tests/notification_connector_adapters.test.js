import test from "node:test";
import assert from "node:assert/strict";
import { getConnectorAdapter } from "../backend/src/services/notification-connectors/adapter-registry.js";

function assertRetryPolicy(adapter) {
  const queued = adapter.retryPolicy(0);
  assert.deepEqual(queued, { nextRetryCount: 1, status: "QUEUED" });

  const failed = adapter.retryPolicy(2);
  assert.deepEqual(failed, { nextRetryCount: 3, status: "FAILED" });
}

test("EMAIL adapter contract: validate, payload, retry policy", () => {
  const adapter = getConnectorAdapter("EMAIL");

  assert.throws(
    () => adapter.validate({ recipient: "bad-email", subject: "s", body: "b" }),
    /valid email/
  );
  assert.throws(
    () => adapter.validate({ recipient: "ok@example.local", body: "b" }),
    /subject is required/
  );
  assert.throws(
    () => adapter.validate({ recipient: "ok@example.local", subject: "s" }),
    /body is required/
  );

  adapter.validate({ recipient: "ok@example.local", subject: "subject", body: "body" });

  const payload = adapter.buildExportPayload({
    recipient: "ok@example.local",
    subject: "subject",
    body: "body"
  });
  assert.deepEqual(payload, {
    recipient: "ok@example.local",
    subject: "subject",
    body: "body"
  });

  assertRetryPolicy(adapter);
});

test("SMS adapter contract: validate, payload, retry policy", () => {
  const adapter = getConnectorAdapter("SMS");

  assert.throws(
    () => adapter.validate({ recipient: "nope", body: "text" }),
    /valid phone number/
  );
  assert.throws(
    () => adapter.validate({ recipient: "+12025550123" }),
    /body is required/
  );

  adapter.validate({ recipient: "+12025550123", subject: "optional", body: "text" });

  const payload = adapter.buildExportPayload({
    recipient: "+12025550123",
    subject: "optional",
    body: "text"
  });
  assert.deepEqual(payload, {
    recipient: "+12025550123",
    subject: "optional",
    body: "text"
  });

  assertRetryPolicy(adapter);
});

test("IM adapter contract: validate, payload, retry policy", () => {
  const adapter = getConnectorAdapter("IM");

  assert.throws(
    () => adapter.validate({ body: "hello" }),
    /recipient is required/
  );
  assert.throws(
    () => adapter.validate({ recipient: "user-1" }),
    /body is required/
  );

  adapter.validate({ recipient: "user-1", body: "hello" });

  const payload = adapter.buildExportPayload({
    recipient: "user-1",
    subject: "optional",
    body: "hello"
  });
  assert.deepEqual(payload, {
    recipient: "user-1",
    subject: "optional",
    body: "hello"
  });

  assertRetryPolicy(adapter);
});

test("adapter registry rejects unsupported connector channel", () => {
  assert.throws(() => getConnectorAdapter("FAX"), /Unsupported connector channel: FAX/);
});
