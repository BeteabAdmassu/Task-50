import { computed, ref } from "vue";
import { apiRequest } from "../api.js";

export function usePlanningWorkspace(auth) {
  const mpsForm = ref({
    siteId: auth.user?.siteId || 1,
    planName: "12 Week Plan",
    startWeek: "",
    weeks: Array.from({ length: 12 }, (_, i) => ({ weekIndex: i + 1, itemCode: "", plannedQty: 0 }))
  });
  const mrpPlanId = ref("");
  const mrpOutput = ref([]);
  const workOrderForm = ref({ planId: "", itemCode: "", qtyTarget: 0, scheduledStart: "", scheduledEnd: "" });
  const workOrderEventForm = ref({ workOrderId: "", eventType: "PRODUCTION", qty: 0, reasonCode: "", notes: "" });
  const workOrderEventStatus = ref("");
  const adjustmentForm = ref({ planId: "", reasonCode: "", before: "{}", after: "{}" });
  const adjustmentApproveForm = ref({ adjustmentId: "" });
  const adjustmentApproveStatus = ref("");

  const canApproveAdjustments = computed(() => ["ADMIN", "PLANNER_SUPERVISOR"].includes(auth.role));

  async function saveMps() {
    await apiRequest("/planning/mps", { method: "POST", body: JSON.stringify(mpsForm.value) });
  }

  async function runMrp() {
    mrpOutput.value = await apiRequest(`/planning/mps/${mrpPlanId.value}/mrp`);
  }

  async function createWorkOrder() {
    await apiRequest("/planning/work-orders", { method: "POST", body: JSON.stringify(workOrderForm.value) });
  }

  async function logWorkOrderEvent() {
    workOrderEventStatus.value = "";
    if (workOrderEventForm.value.eventType === "DOWNTIME" && !workOrderEventForm.value.reasonCode.trim()) {
      workOrderEventStatus.value = "Downtime reason code is required.";
      return;
    }

    await apiRequest(`/planning/work-orders/${workOrderEventForm.value.workOrderId}/events`, {
      method: "POST",
      body: JSON.stringify({
        eventType: workOrderEventForm.value.eventType,
        qty: Number(workOrderEventForm.value.qty) || 0,
        reasonCode: workOrderEventForm.value.reasonCode || null,
        notes: workOrderEventForm.value.notes || null
      })
    });
    workOrderEventStatus.value = "Work order event logged.";
  }

  async function requestAdjustment() {
    const payload = {
      ...adjustmentForm.value,
      before: JSON.parse(adjustmentForm.value.before || "{}"),
      after: JSON.parse(adjustmentForm.value.after || "{}")
    };
    await apiRequest(`/planning/plans/${adjustmentForm.value.planId}/adjustments`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async function approveAdjustment() {
    adjustmentApproveStatus.value = "";
    if (!adjustmentApproveForm.value.adjustmentId) {
      adjustmentApproveStatus.value = "Adjustment ID is required.";
      return;
    }
    try {
      await apiRequest(`/planning/adjustments/${adjustmentApproveForm.value.adjustmentId}/approve`, {
        method: "POST"
      });
      adjustmentApproveStatus.value = "Adjustment approved.";
    } catch (err) {
      adjustmentApproveStatus.value = `Approval failed: ${err.message}`;
    }
  }

  return {
    mpsForm,
    mrpPlanId,
    mrpOutput,
    workOrderForm,
    workOrderEventForm,
    workOrderEventStatus,
    adjustmentForm,
    adjustmentApproveForm,
    adjustmentApproveStatus,
    canApproveAdjustments,
    saveMps,
    runMrp,
    createWorkOrder,
    logWorkOrderEvent,
    requestAdjustment,
    approveAdjustment
  };
}
