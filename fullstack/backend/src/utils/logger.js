function scrub(value) {
  if (value == null) return value;
  if (typeof value !== "string") return value;
  if (/password|token|authorization|ssn/i.test(value)) return "[REDACTED]";
  return value;
}

function sanitizeMeta(meta = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(meta)) {
    if (/password|token|authorization|ssn/i.test(key)) {
      clean[key] = "[REDACTED]";
      continue;
    }
    clean[key] = typeof value === "string" ? scrub(value) : value;
  }
  return clean;
}

function write(level, category, message, meta = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    category,
    message,
    ...sanitizeMeta(meta)
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info(category, message, meta) {
    write("info", category, message, meta);
  },
  warn(category, message, meta) {
    write("warn", category, message, meta);
  },
  error(category, message, meta) {
    write("error", category, message, meta);
  }
};
