<script setup>
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { apiFormRequest, apiRequest } from "../api.js";
import WorkspaceSidebar from "../components/workspace/WorkspaceSidebar.vue";
import OverviewPanel from "../components/workspace/OverviewPanel.vue";
import DockPanel from "../components/workspace/DockPanel.vue";
import ReceivingPanel from "../components/workspace/ReceivingPanel.vue";
import PutawayPanel from "../components/workspace/PutawayPanel.vue";
import MpsPanel from "../components/workspace/MpsPanel.vue";
import MrpPanel from "../components/workspace/MrpPanel.vue";
import WorkOrdersPanel from "../components/workspace/WorkOrdersPanel.vue";
import AdjustmentsPanel from "../components/workspace/AdjustmentsPanel.vue";
import CandidateApplicationPanel from "../components/workspace/CandidateApplicationPanel.vue";
import RulesPanel from "../components/workspace/RulesPanel.vue";
import NotificationsPanel from "../components/workspace/NotificationsPanel.vue";
import SearchPanel from "../components/workspace/SearchPanel.vue";
import AuditPanel from "../components/workspace/AuditPanel.vue";

const auth = useAuthStore();
const dashboard = ref({ widgets: {} });
const activePanel = ref("overview");
const error = ref("");

const panelsByRole = {
  ADMIN: ["overview", "search", "notifications", "audit"],
  CLERK: ["overview", "dock", "receiving", "putaway", "search"],
  PLANNER: ["overview", "mps", "mrp", "workorders", "adjustments", "search"],
  PLANNER_SUPERVISOR: ["overview", "mps", "mrp", "workorders", "adjustments", "search"],
  HR: ["overview", "candidates", "rules", "notifications", "search"],
  INTERVIEWER: ["overview", "candidates", "notifications", "search"],
  CANDIDATE: ["overview", "candidatePortal"]
};

const availablePanels = computed(() => panelsByRole[auth.role] || ["overview"]);

const dockForm = ref({ siteId: auth.user?.siteId || "", poNumber: "", startAt: "", endAt: "", notes: "" });
const receiptForm = ref({ siteId: auth.user?.siteId || "", poNumber: "", lines: [{ poLineNo: "1", sku: "", lotNo: "", qtyExpected: 0, qtyReceived: 0, discrepancyType: "", dispositionNote: "" }] });
const putawayInput = ref({ sku: "", lotNo: "", quantity: 0 });
const putawayResult = ref(null);
const mpsForm = ref({ siteId: auth.user?.siteId || 1, planName: "12 Week Plan", startWeek: "", weeks: Array.from({ length: 12 }, (_, i) => ({ weekIndex: i + 1, itemCode: "", plannedQty: 0 })) });
const mrpPlanId = ref("");
const mrpOutput = ref([]);
const workOrderForm = ref({ planId: "", itemCode: "", qtyTarget: 0, scheduledStart: "", scheduledEnd: "" });
const workOrderEventForm = ref({ workOrderId: "", eventType: "PRODUCTION", qty: 0, reasonCode: "", notes: "" });
const workOrderEventStatus = ref("");
const adjustmentForm = ref({ planId: "", reasonCode: "", before: "{}", after: "{}" });
const candidateForm = ref({ fullName: "", email: "", phone: "", dob: "", ssnLast4: "", source: "PORTAL", formData: [] });
const appFormFields = ref([]);
const candidateAttachment = ref(null);
const lastCandidateId = ref("");
const candidateUploadStatus = ref("");
const scoreForm = ref({ candidateId: "", ruleVersionId: "", courseworkScores: [0], midtermScores: [0], finalScores: [0], creditHours: 3 });
const notifForm = ref({ topic: "RECEIPT_ACK", frequency: "IMMEDIATE", dndStart: "21:00", dndEnd: "07:00" });
const searchForm = ref({ q: "", source: "", topic: "", entityType: "", startDate: "", endDate: "" });
const searchResults = ref([]);

onMounted(loadDashboard);

async function loadDashboard() {
  try {
    dashboard.value = await apiRequest("/dashboard");
    appFormFields.value = await apiRequest("/hr/forms/application");
    candidateForm.value.formData = appFormFields.value.map((field) => ({ fieldKey: field.field_key, fieldValue: "" }));
  } catch (err) {
    error.value = err.message;
  }
}

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

async function runPutaway() {
  putawayResult.value = await apiRequest("/receiving/putaway/recommend", { method: "POST", body: JSON.stringify(putawayInput.value) });
}

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

async function submitCandidate() {
  candidateUploadStatus.value = "";
  try {
    const created = await apiRequest("/hr/applications", { method: "POST", body: JSON.stringify(candidateForm.value) });
    lastCandidateId.value = created.id;
    if (!candidateAttachment.value) {
      candidateUploadStatus.value = "Application submitted. No attachment uploaded.";
      return;
    }

    const formData = new FormData();
    formData.append("file", candidateAttachment.value);
    const headers = {};
    if (created.uploadToken) headers["x-candidate-upload-token"] = created.uploadToken;

    try {
      await apiFormRequest(`/hr/applications/${created.id}/attachments`, formData, { headers });
      candidateUploadStatus.value = "Application and attachment uploaded successfully.";
    } catch (uploadErr) {
      candidateUploadStatus.value = `Application submitted, but attachment upload failed: ${uploadErr.message}`;
    }
  } catch (err) {
    candidateUploadStatus.value = `Application submission failed: ${err.message}`;
  }
}

function getFormEntry(fieldKey) {
  const found = candidateForm.value.formData.find((item) => item.fieldKey === fieldKey);
  if (found) return found;
  const created = { fieldKey, fieldValue: "" };
  candidateForm.value.formData.push(created);
  return created;
}

function onCandidateFileChange(event) {
  candidateAttachment.value = event.target.files?.[0] || null;
}

async function subscribeNotifications() {
  await apiRequest("/notifications/subscriptions", { method: "POST", body: JSON.stringify(notifForm.value) });
}

async function computeScore() {
  await apiRequest("/rules/score", { method: "POST", body: JSON.stringify(scoreForm.value) });
}

async function searchAll() {
  const params = new URLSearchParams(searchForm.value).toString();
  searchResults.value = await apiRequest(`/search?${params}`);
}

async function logout() {
  await auth.logout();
  window.location.href = "/login";
}
</script>

<template>
  <main class="workspace-shell">
    <WorkspaceSidebar
      :user="auth.user"
      :role="auth.role"
      :panels="availablePanels"
      :active-panel="activePanel"
      @update:active-panel="activePanel = $event"
      @logout="logout"
    />

    <section class="workspace-main">
      <header>
        <h1>{{ activePanel }}</h1>
        <p v-if="error" class="error">{{ error }}</p>
      </header>

      <OverviewPanel v-if="activePanel === 'overview'" :widgets="dashboard.widgets" />

      <DockPanel v-if="activePanel === 'dock'" :dock-form="dockForm" :on-submit-dock="submitDock" />

      <ReceivingPanel
        v-if="activePanel === 'receiving'"
        :receipt-form="receiptForm"
        :on-submit-receipt="submitReceipt"
      />

      <PutawayPanel
        v-if="activePanel === 'putaway'"
        :putaway-input="putawayInput"
        :putaway-result="putawayResult"
        :on-run-putaway="runPutaway"
      />

      <MpsPanel v-if="activePanel === 'mps'" :mps-form="mpsForm" :on-save-mps="saveMps" />

      <MrpPanel
        v-if="activePanel === 'mrp'"
        :mrp-plan-id="mrpPlanId"
        :mrp-output="mrpOutput"
        :on-run-mrp="runMrp"
        @update:mrpPlanId="mrpPlanId = $event"
      />

      <WorkOrdersPanel
        v-if="activePanel === 'workorders'"
        :work-order-form="workOrderForm"
        :work-order-event-form="workOrderEventForm"
        :work-order-event-status="workOrderEventStatus"
        :on-create-work-order="createWorkOrder"
        :on-log-work-order-event="logWorkOrderEvent"
      />

      <AdjustmentsPanel
        v-if="activePanel === 'adjustments'"
        :adjustment-form="adjustmentForm"
        :on-request-adjustment="requestAdjustment"
      />

      <CandidateApplicationPanel
        v-if="activePanel === 'candidates' || activePanel === 'candidatePortal'"
        :candidate-form="candidateForm"
        :app-form-fields="appFormFields"
        :last-candidate-id="lastCandidateId"
        :candidate-upload-status="candidateUploadStatus"
        :on-candidate-file-change="onCandidateFileChange"
        :on-submit-candidate="submitCandidate"
        :get-form-entry="getFormEntry"
      />

      <RulesPanel v-if="activePanel === 'rules'" :score-form="scoreForm" :on-compute-score="computeScore" />

      <NotificationsPanel
        v-if="activePanel === 'notifications'"
        :notif-form="notifForm"
        :on-subscribe-notifications="subscribeNotifications"
      />

      <SearchPanel
        v-if="activePanel === 'search'"
        :search-form="searchForm"
        :search-results="searchResults"
        :on-search-all="searchAll"
      />

      <AuditPanel v-if="activePanel === 'audit'" />
    </section>
  </main>
</template>
