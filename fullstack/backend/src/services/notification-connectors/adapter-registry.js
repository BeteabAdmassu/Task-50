import { AppError } from "../../utils/errors.js";
import { emailConnectorAdapter } from "./email-adapter.js";
import { smsConnectorAdapter } from "./sms-adapter.js";
import { imConnectorAdapter } from "./im-adapter.js";

const adapters = {
  EMAIL: emailConnectorAdapter,
  SMS: smsConnectorAdapter,
  IM: imConnectorAdapter
};

export function getConnectorAdapter(channel) {
  const normalized = String(channel || "").toUpperCase();
  const adapter = adapters[normalized];
  if (!adapter) {
    throw new AppError(400, `Unsupported connector channel: ${channel}`);
  }
  return adapter;
}

export function getRegisteredConnectorChannels() {
  return Object.keys(adapters);
}
