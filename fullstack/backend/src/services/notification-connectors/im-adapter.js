import { AppError } from "../../utils/errors.js";

export const imConnectorAdapter = {
  channel: "IM",
  validate(input) {
    if (!input?.recipient || String(input.recipient).trim().length === 0) {
      throw new AppError(400, "IM recipient is required");
    }
    if (!input?.body || String(input.body).trim().length === 0) {
      throw new AppError(400, "IM body is required");
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
