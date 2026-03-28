import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fullstackDir = path.resolve(currentDir, "..", "..");
const nodeEnv = process.env.NODE_ENV || "development";

const defaultJwtSecret = "forgeops-local-dev-secret";
const defaultEncryptionKey =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

function assertSecretSafety() {
  const jwtSecret = process.env.JWT_SECRET || defaultJwtSecret;
  const encryptionKeyHex = process.env.ENCRYPTION_KEY_HEX || defaultEncryptionKey;
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    if (!process.env.JWT_SECRET || jwtSecret === defaultJwtSecret) {
      throw new Error("JWT_SECRET must be explicitly set and non-default outside development/test");
    }
    if (!process.env.ENCRYPTION_KEY_HEX || encryptionKeyHex === defaultEncryptionKey) {
      throw new Error(
        "ENCRYPTION_KEY_HEX must be explicitly set and non-default outside development/test"
      );
    }
  }
  if (!/^[a-fA-F0-9]{64}$/.test(encryptionKeyHex)) {
    throw new Error("ENCRYPTION_KEY_HEX must be a 64-character hex string");
  }
}

assertSecretSafety();

export const config = {
  env: nodeEnv,
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || defaultJwtSecret,
  jwtTtlSeconds: 60 * 30,
  idleTimeoutSeconds: 60 * 30,
  accountLockMinutes: 15,
  maxFailedLogins: 5,
  defaultDndStart: process.env.DEFAULT_DND_START || "21:00",
  defaultDndEnd: process.env.DEFAULT_DND_END || "07:00",
  uploadDir: process.env.UPLOAD_DIR || path.join(fullstackDir, "storage", "uploads"),
  exportDir: process.env.EXPORT_DIR || path.join(fullstackDir, "storage", "message_exports"),
  encryptionKeyHex: process.env.ENCRYPTION_KEY_HEX || defaultEncryptionKey,
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "password",
    database: process.env.DB_NAME || "forgeops",
    connectionLimit: 10,
    timezone: "Z"
  }
};
