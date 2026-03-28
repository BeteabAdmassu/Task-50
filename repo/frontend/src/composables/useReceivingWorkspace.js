import { ref } from "vue";
import { apiFormRequest, apiRequest } from "../api.js";

export function useReceivingWorkspace(auth) {
  const dockForm = ref({ siteId: auth.user?.siteId || "", poNumber: "", startAt: "", endAt: "", notes: "" });
  const receiptForm = ref({
    siteId: auth.user?.siteId || "",
    poNumber: "",
    lines: [{ poLineNo: "1", sku: "", lotNo: "", qtyExpected: 0, qtyReceived: 0, inspectionStatus: "PENDING", discrepancyType: "", dispositionNote: "" }]
  });
  const receiptCloseForm = ref({ receiptId: "" });
  const receiptCloseStatus = ref("");
  const receiptDocumentForm = ref({
    receiptId: "",
    poLineNo: "",
    lotNo: "",
    storageLocationId: "",
    title: "",
    file: null
  });
  const receiptDocuments = ref([]);
  const receiptDocumentStatus = ref("");
  const putawayInput = ref({ sku: "", lotNo: "", quantity: 0 });
  const putawayResult = ref(null);

  async function submitDock() {
    await apiRequest("/receiving/dock-appointments", { method: "POST", body: JSON.stringify(dockForm.value) });
  }

  async function submitReceipt() {
    const payload = {
      ...receiptForm.value,
      lines: receiptForm.value.lines.map((line) => ({
        ...line,
        discrepancyType: line.discrepancyType || null,
        dispositionNote: line.dispositionNote || null,
        qtyDelta: Number(line.qtyReceived) - Number(line.qtyExpected)
      }))
    };
    await apiRequest("/receiving/receipts", { method: "POST", body: JSON.stringify(payload) });
  }

  async function closeReceipt() {
    receiptCloseStatus.value = "";
    if (!receiptCloseForm.value.receiptId) {
      receiptCloseStatus.value = "Receipt ID is required.";
      return;
    }
    try {
      await apiRequest(`/receiving/receipts/${receiptCloseForm.value.receiptId}/close`, {
        method: "POST"
      });
      receiptCloseStatus.value = "Receipt closed successfully.";
    } catch (err) {
      receiptCloseStatus.value = `Failed to close receipt: ${err.message}`;
    }
  }

  async function runPutaway() {
    putawayResult.value = await apiRequest("/receiving/putaway/recommend", {
      method: "POST",
      body: JSON.stringify({
        ...putawayInput.value,
        siteId: auth.user?.siteId || ""
      })
    });
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
    receiptDocumentForm,
    receiptDocuments,
    receiptDocumentStatus,
    putawayInput,
    putawayResult,
    submitDock,
    submitReceipt,
    closeReceipt,
    runPutaway,
    onReceiptDocumentFileChange,
    uploadReceiptDocument,
    loadReceiptDocuments
  };
}
