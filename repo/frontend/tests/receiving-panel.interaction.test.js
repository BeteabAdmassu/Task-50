import { mount } from "@vue/test-utils";
import { test, expect, vi } from "vitest";
import ReceivingPanel from "../src/components/workspace/ReceivingPanel.vue";

function buildProps() {
  return {
    receiptForm: {
      siteId: "1",
      poNumber: "PO-1",
      lines: [
        {
          poLineNo: "1",
          sku: "SKU-1",
          lotNo: "LOT-1",
          qtyExpected: 10,
          qtyReceived: 10,
          inspectionStatus: "PENDING",
          discrepancyType: "",
          dispositionNote: ""
        }
      ]
    },
    onSubmitReceipt: vi.fn(),
    receiptCloseForm: { receiptId: "" },
    receiptCloseStatus: "",
    onCloseReceipt: vi.fn(),
    receiptDocumentForm: {
      receiptId: "100",
      poLineNo: "1",
      lotNo: "LOT-1",
      storageLocationId: "",
      title: "BOL",
      file: null
    },
    receiptDocuments: [
      { id: "doc-1", original_name: "bol.pdf", mime_type: "application/pdf" }
    ],
    receiptDocumentStatus: "Documents loaded.",
    onReceiptDocumentFileChange: vi.fn(),
    onUploadReceiptDocument: vi.fn(),
    onLoadReceiptDocuments: vi.fn()
  };
}

test("receiving panel captures inspection status per line", async () => {
  const props = buildProps();
  const wrapper = mount(ReceivingPanel, { props });

  const inspectionSelect = wrapper.findAll("select")[0];
  await inspectionSelect.setValue("FAIL");

  expect(props.receiptForm.lines[0].inspectionStatus).toBe("FAIL");
});

test("receiving panel exposes receipt document upload/list actions", async () => {
  const props = buildProps();
  const wrapper = mount(ReceivingPanel, { props });

  const buttons = wrapper.findAll("button");
  const uploadButton = buttons.find((button) => button.text() === "Upload document");
  const loadButton = buttons.find((button) => button.text() === "Load documents");

  await uploadButton.trigger("click");
  await loadButton.trigger("click");

  expect(props.onUploadReceiptDocument).toHaveBeenCalledTimes(1);
  expect(props.onLoadReceiptDocuments).toHaveBeenCalledTimes(1);
  expect(wrapper.text()).toContain("Documents loaded.");
  expect(wrapper.text()).toContain("bol.pdf");
});
