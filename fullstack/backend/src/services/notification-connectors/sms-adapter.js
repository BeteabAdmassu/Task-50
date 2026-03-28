import { AppError } from "../../utils/errors.js";

function looksLikePhone(value) {
  return /^\+?[0-9\-\s()]{7,20}$/.test(String(value || ""));
}

export const smsConnectorAdapter = {
  channel: "SMS",
  validate(input) {
    if (!looksLikePhone(input?.recipient)) {
      throw new AppError(400, "SMS recipient must be a valid phone number");
    }
    if (!input?.body || String(input.body).trim().length === 0) {
      throw new AppError(400, "SMS body is required");
    }
  },
  buildExportPayload(input) {
    return {
      recipient: input.recipient,
      subject: input.subject || null,
      body: input.body
    };
  },
  retryPolicy(currentRetryCount) {
    const nextRetryCount = Number(currentRetryCount) + 1;
    return {
      nextRetryCount,
      status: nextRetryCount >= 3 ? "FAILED" : "QUEUED"
    };
  }
};
