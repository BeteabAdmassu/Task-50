import { test, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api.js", () => ({
  apiRequest: vi.fn(async () => ({}))
}));

import { apiRequest } from "../src/api.js";
import { usePlanningWorkspace } from "../src/composables/usePlanningWorkspace.js";

beforeEach(() => {
  vi.clearAllMocks();
});

test("requestAdjustment handles malformed JSON without locking loading state", async () => {
  const workspace = usePlanningWorkspace({
    role: "PLANNER",
    user: { siteId: 1 }
  });

  workspace.adjustmentForm.value.planId = "123";
  workspace.adjustmentForm.value.reasonCode = "SCOPE";
  workspace.adjustmentForm.value.before = "{";
  workspace.adjustmentForm.value.after = "{}";

  await workspace.requestAdjustment();

  expect(workspace.isRequestingAdjustment.value).toBe(false);
  expect(workspace.adjustmentApproveStatus.value).toBe("Adjustment JSON must be valid.");
});

test("requestAdjustment sets failure status without throwing on API error", async () => {
  apiRequest.mockRejectedValueOnce(new Error("Server unavailable"));

  const workspace = usePlanningWorkspace({
    role: "PLANNER",
    user: { siteId: 1 }
  });

  workspace.adjustmentForm.value.planId = "123";
  workspace.adjustmentForm.value.reasonCode = "SCOPE";
  workspace.adjustmentForm.value.before = "{}";
  workspace.adjustmentForm.value.after = "{}";

  await expect(workspace.requestAdjustment()).resolves.toBeUndefined();
  expect(workspace.isRequestingAdjustment.value).toBe(false);
  expect(workspace.adjustmentApproveStatus.value).toBe("Adjustment request failed: Server unavailable");
});

test("requestAdjustment sets success status and resets loading", async () => {
  apiRequest.mockResolvedValueOnce({ id: 88 });

  const workspace = usePlanningWorkspace({
    role: "PLANNER",
    user: { siteId: 1 }
  });

  workspace.adjustmentForm.value.planId = "123";
  workspace.adjustmentForm.value.reasonCode = "SCOPE";
  workspace.adjustmentForm.value.before = "{}";
  workspace.adjustmentForm.value.after = "{}";

  await workspace.requestAdjustment();

  expect(workspace.isRequestingAdjustment.value).toBe(false);
  expect(workspace.adjustmentApproveStatus.value).toBe("Adjustment submitted for approval.");
});
