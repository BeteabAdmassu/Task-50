import { test, expect, vi, beforeEach } from "vitest";

const apiRequestMock = vi.fn();
const apiFormRequestMock = vi.fn();

vi.mock("../src/api.js", () => ({
  apiRequest: (...args) => apiRequestMock(...args),
  apiFormRequest: (...args) => apiFormRequestMock(...args)
}));

import { useReceivingWorkspace } from "../src/composables/useReceivingWorkspace.js";

beforeEach(() => {
  apiRequestMock.mockReset();
  apiFormRequestMock.mockReset();
});

test("receiving workspace uploads and lists receipt documents via API endpoints", async () => {
  const workspace = useReceivingWorkspace({ user: { siteId: 1 } });
  workspace.receiptDocumentForm.value.receiptId = "55";
  workspace.receiptDocumentForm.value.poLineNo = "1";
  workspace.receiptDocumentForm.value.batchNo = "B-55";
  workspace.receiptDocumentForm.value.title = "BOL";
  workspace.receiptDocumentForm.value.file = new File(["pdf"], "bol.pdf", { type: "application/pdf" });

  apiFormRequestMock.mockResolvedValueOnce({ id: "doc-55" });
  apiRequestMock.mockResolvedValueOnce([
    { id: "doc-55", original_name: "bol.pdf", mime_type: "application/pdf" }
  ]);

  await workspace.uploadReceiptDocument();

  expect(apiFormRequestMock).toHaveBeenCalledTimes(1);
  expect(apiFormRequestMock.mock.calls[0][0]).toBe("/receiving/receipts/55/documents");
  expect(apiRequestMock).toHaveBeenCalledWith("/receiving/receipts/55/documents");
  expect(workspace.receiptDocuments.value).toHaveLength(1);
  expect(workspace.receiptDocumentStatus.value).toBe("Documents loaded.");
});

test("receiving workspace requires inspection status in receipt payload", async () => {
  const workspace = useReceivingWorkspace({ user: { siteId: 1 } });
  workspace.receiptForm.value.lines[0].inspectionStatus = "PASS";
  workspace.receiptForm.value.lines[0].batchNo = "B-100";
  apiRequestMock.mockResolvedValueOnce({ id: 22 });

  await workspace.submitReceipt();

  const [, options] = apiRequestMock.mock.calls[0];
  const payload = JSON.parse(options.body);
  expect(payload.lines[0].inspectionStatus).toBe("PASS");
  expect(payload.lines[0].batchNo).toBe("B-100");
});
