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
  const isSavingMps = ref(false);
  const isRunningMrp = ref(false);
  const isCreatingWorkOrder = ref(false);
  const isLoggingWorkOrderEvent = ref(false);
  const isRequestingAdjustment = ref(false);
  const isApprovingAdjustment = ref(false);
  const adjustmentForm = ref({ planId: "", reasonCode: "", before: "{}", after: "{}" });
  const adjustmentApproveForm = ref({ adjustmentId: "" });
  const adjustmentApproveStatus = ref("");

  const canApproveAdjustments = computed(() => ["ADMIN", "PLANNER_SUPERVISOR"].includes(auth.role));

  async function saveMps() {
    if (isSavingMps.value) return;
    isSavingMps.value = true;
    try {
      await apiRequest("/planning/mps", { method: "POST", body: JSON.stringify(mpsForm.value) });
    } finally {
      isSavingMps.value = false;
    }
  }

  async function runMrp() {
    if (isRunningMrp.value) return;
    isRunningMrp.value = true;
    try {
      mrpOutput.value = await apiRequest(`/planning/mps/${mrpPlanId.value}/mrp`);
    } finally {
      isRunningMrp.value = false;
    }
  }

  async function createWorkOrder() {
    if (isCreatingWorkOrder.value) return;
    isCreatingWorkOrder.value = true;
    try {
      await apiRequest("/planning/work-orders", { method: "POST", body: JSON.stringify(workOrderForm.value) });
    } finally {
      isCreatingWorkOrder.value = false;
    }
  }

  async function logWorkOrderEvent() {
    if (isLoggingWorkOrderEvent.value) return;
    workOrderEventStatus.value = "";
    if (workOrderEventForm.value.eventType === "DOWNTIME" && !workOrderEventForm.value.reasonCode.trim()) {
      workOrderEventStatus.value = "Downtime reason code is required.";
      return;
    }

    isLoggingWorkOrderEvent.value = true;
    try {
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
    } finally {
      isLoggingWorkOrderEvent.value = false;
    }
  }

  async function requestAdjustment() {
    if (isRequestingAdjustment.value) return;
    let payload;
    try {
      payload = {
        ...adjustmentForm.value,
        before: JSON.parse(adjustmentForm.value.before || "{}"),
        after: JSON.parse(adjustmentForm.value.after || "{}")
      };
    } catch {
      adjustmentApproveStatus.value = "Adjustment JSON must be valid.";
      return;
    }

    adjustmentApproveStatus.value = "";
    isRequestingAdjustment.value = true;
    try {
      await apiRequest(`/planning/plans/${adjustmentForm.value.planId}/adjustments`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      adjustmentApproveStatus.value = "Adjustment submitted for approval.";
    } catch (err) {
      adjustmentApproveStatus.value = `Adjustment request failed: ${err.message}`;
    } finally {
      isRequestingAdjustment.value = false;
    }
  }

  async function approveAdjustment() {
    if (isApprovingAdjustment.value) return;
    adjustmentApproveStatus.value = "";
    if (!adjustmentApproveForm.value.adjustmentId) {
      adjustmentApproveStatus.value = "Adjustment ID is required.";
      return;
    }
    isApprovingAdjustment.value = true;
    try {
      await apiRequest(`/planning/adjustments/${adjustmentApproveForm.value.adjustmentId}/approve`, {
        method: "POST"
      });
      adjustmentApproveStatus.value = "Adjustment approved.";
    } catch (err) {
      adjustmentApproveStatus.value = `Approval failed: ${err.message}`;
    } finally {
      isApprovingAdjustment.value = false;
    }
  }

  return {
    mpsForm,
    mrpPlanId,
    mrpOutput,
    workOrderForm,
    workOrderEventForm,
    workOrderEventStatus,
    isSavingMps,
    isRunningMrp,
    isCreatingWorkOrder,
    isLoggingWorkOrderEvent,
    isRequestingAdjustment,
    isApprovingAdjustment,
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
