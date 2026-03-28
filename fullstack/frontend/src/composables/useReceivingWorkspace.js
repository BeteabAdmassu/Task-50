import { ref } from "vue";
import { apiRequest } from "../api.js";

export function useReceivingWorkspace(auth) {
  const dockForm = ref({ siteId: auth.user?.siteId || "", poNumber: "", startAt: "", endAt: "", notes: "" });
  const receiptForm = ref({
    siteId: auth.user?.siteId || "",
    poNumber: "",
    lines: [{ poLineNo: "1", sku: "", lotNo: "", qtyExpected: 0, qtyReceived: 0, discrepancyType: "", dispositionNote: "" }]
  });
  const receiptCloseForm = ref({ receiptId: "" });
  const receiptCloseStatus = ref("");
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
      body: JSON.stringify(putawayInput.value)
    });
  }

  return {
    dockForm,
    receiptForm,
    receiptCloseForm,
    receiptCloseStatus,
    putawayInput,
    putawayResult,
    submitDock,
    submitReceipt,
    closeReceipt,
    runPutaway
  };
}
