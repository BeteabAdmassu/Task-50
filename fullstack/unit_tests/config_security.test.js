import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const configModulePath = "./backend/src/config.js";

test("config fails fast in production without explicit JWT/encryption secrets", () => {
  const child = spawnSync(
    process.execPath,
    ["-e", `import('${configModulePath}');`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        JWT_SECRET: "",
        ENCRYPTION_KEY_HEX: ""
      }
    }
  );
  assert.notEqual(child.status, 0);
  const stderr = (child.stderr || Buffer.from("")).toString();
  assert.match(stderr, /JWT_SECRET must be explicitly set|ENCRYPTION_KEY_HEX must be explicitly set/);
});

test("config allows defaults in test mode", () => {
  const child = spawnSync(
    process.execPath,
    ["-e", `import('${configModulePath}').then(() => process.exit(0));`],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test"
      }
    }
  );
  assert.equal(child.status, 0);
});
