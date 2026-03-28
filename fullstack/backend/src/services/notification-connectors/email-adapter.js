import { AppError } from "../../utils/errors.js";

export const emailConnectorAdapter = {
  channel: "EMAIL",
  validate(input) {
    if (!input?.recipient || !String(input.recipient).includes("@")) {
      throw new AppError(400, "EMAIL recipient must be a valid email address");
    }
    if (!input?.subject || String(input.subject).trim().length === 0) {
      throw new AppError(400, "EMAIL subject is required");
    }
    if (!input?.body || String(input.body).trim().length === 0) {
      throw new AppError(400, "EMAIL body is required");
    }
  },
  buildExportPayload(input) {
    return {
      recipient: input.recipient,
      subject: input.subject,
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
