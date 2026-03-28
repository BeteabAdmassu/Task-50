import { ref } from "vue";
import { apiFormRequest, apiRequest } from "../api.js";

export function useReceivingWorkspace(auth) {
  const dockForm = ref({ siteId: auth.user?.siteId || "", poNumber: "", startAt: "", endAt: "", notes: "" });
  const receiptForm = ref({
    siteId: auth.user?.siteId || "",
    poNumber: "",
    lines: [{ poLineNo: "1", sku: "", lotNo: "", batchNo: "", qtyExpected: 0, qtyReceived: 0, inspectionStatus: "PENDING", discrepancyType: "", dispositionNote: "" }]
  });
  const receiptCloseForm = ref({ receiptId: "" });
  const receiptCloseStatus = ref("");
  const isSubmittingReceipt = ref(false);
  const isClosingReceipt = ref(false);
  const receiptDocumentForm = ref({
    receiptId: "",
    poLineNo: "",
    lotNo: "",
    batchNo: "",
    storageLocationId: "",
    title: "",
    file: null
  });
  const receiptDocuments = ref([]);
  const receiptDocumentStatus = ref("");
  const putawayInput = ref({ sku: "", lotNo: "", quantity: 0 });
  const putawayResult = ref(null);
  const isRunningPutaway = ref(false);

  async function submitDock() {
    await apiRequest("/receiving/dock-appointments", { method: "POST", body: JSON.stringify(dockForm.value) });
  }

  async function submitReceipt() {
    if (isSubmittingReceipt.value) return;
    isSubmittingReceipt.value = true;
    const payload = {
      ...receiptForm.value,
      lines: receiptForm.value.lines.map((line) => ({
        ...line,
        discrepancyType: line.discrepancyType || null,
        dispositionNote: line.dispositionNote || null,
        qtyDelta: Number(line.qtyReceived) - Number(line.qtyExpected)
      }))
    };
    try {
      await apiRequest("/receiving/receipts", { method: "POST", body: JSON.stringify(payload) });
    } finally {
      isSubmittingReceipt.value = false;
    }
  }

  async function closeReceipt() {
    if (isClosingReceipt.value) return;
    receiptCloseStatus.value = "";
    if (!receiptCloseForm.value.receiptId) {
      receiptCloseStatus.value = "Receipt ID is required.";
      return;
    }
    isClosingReceipt.value = true;
    try {
      await apiRequest(`/receiving/receipts/${receiptCloseForm.value.receiptId}/close`, {
        method: "POST"
      });
      receiptCloseStatus.value = "Receipt closed successfully.";
    } catch (err) {
      receiptCloseStatus.value = `Failed to close receipt: ${err.message}`;
    } finally {
      isClosingReceipt.value = false;
    }
  }

  async function runPutaway() {
    if (isRunningPutaway.value) return;
    isRunningPutaway.value = true;
    try {
      putawayResult.value = await apiRequest("/receiving/putaway/recommend", {
        method: "POST",
        body: JSON.stringify({
          ...putawayInput.value,
          siteId: auth.user?.siteId || ""
        })
      });
    } finally {
      isRunningPutaway.value = false;
    }
  }

  function onReceiptDocumentFileChange(event) {
    receiptDocumentForm.value.file = event.target.files?.[0] || null;
  }

  async function uploadReceiptDocument() {
    receiptDocumentStatus.value = "";
    if (!receiptDocumentForm.value.receiptId) {
      receiptDocumentStatus.value = "Receipt ID is required.";
      return;
    }
    if (!receiptDocumentForm.value.file) {
      receiptDocumentStatus.value = "Document file is required.";
      return;
    }

    const formData = new FormData();
    formData.append("file", receiptDocumentForm.value.file);
    formData.append("poLineNo", receiptDocumentForm.value.poLineNo || "");
    formData.append("lotNo", receiptDocumentForm.value.lotNo || "");
    formData.append("batchNo", receiptDocumentForm.value.batchNo || "");
    formData.append("storageLocationId", receiptDocumentForm.value.storageLocationId || "");
    formData.append("title", receiptDocumentForm.value.title || "");

    await apiFormRequest(
      `/receiving/receipts/${receiptDocumentForm.value.receiptId}/documents`,
      formData
    );
    receiptDocumentStatus.value = "Document uploaded.";
    await loadReceiptDocuments();
  }

  async function loadReceiptDocuments() {
    receiptDocumentStatus.value = "";
    if (!receiptDocumentForm.value.receiptId) {
      receiptDocumentStatus.value = "Receipt ID is required.";
      return;
    }
    receiptDocuments.value = await apiRequest(
      `/receiving/receipts/${receiptDocumentForm.value.receiptId}/documents`
    );
    receiptDocumentStatus.value = "Documents loaded.";
  }

  return {
    dockForm,
    receiptForm,
    receiptCloseForm,
    receiptCloseStatus,
    isSubmittingReceipt,
    isClosingReceipt,
    receiptDocumentForm,
    receiptDocuments,
    receiptDocumentStatus,
    putawayInput,
    putawayResult,
    isRunningPutaway,
    submitDock,
    submitReceipt,
    closeReceipt,
    runPutaway,
    onReceiptDocumentFileChange,
    uploadReceiptDocument,
    loadReceiptDocuments
  };
}
