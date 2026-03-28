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

test("config uses deterministic encryption fallback in test mode when env is unset", () => {
  const script = `
    import('${configModulePath}').then(({ config }) => {
      process.stdout.write(config.encryptionKeyHex + '\\n');
      process.exit(0);
    });
  `;

  const first = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      ENCRYPTION_KEY_HEX: ""
    }
  });

  const second = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      ENCRYPTION_KEY_HEX: ""
    }
  });

  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  const firstKey = (first.stdout || Buffer.from("")).toString().trim();
  const secondKey = (second.stdout || Buffer.from("")).toString().trim();
  assert.match(firstKey, /^[a-fA-F0-9]{64}$/);
  assert.equal(firstKey, secondKey);
});
