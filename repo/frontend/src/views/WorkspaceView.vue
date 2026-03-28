<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { apiRequest } from "../api.js";
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
import InterviewerReviewPanel from "../components/workspace/InterviewerReviewPanel.vue";
import RulesPanel from "../components/workspace/RulesPanel.vue";
import NotificationsPanel from "../components/workspace/NotificationsPanel.vue";
import SearchPanel from "../components/workspace/SearchPanel.vue";
import AuditPanel from "../components/workspace/AuditPanel.vue";
import { useReceivingWorkspace } from "../composables/useReceivingWorkspace.js";
import { usePlanningWorkspace } from "../composables/usePlanningWorkspace.js";
import { useHrWorkspace } from "../composables/useHrWorkspace.js";
import { useNotificationsWorkspace } from "../composables/useNotificationsWorkspace.js";
import { useSearchWorkspace } from "../composables/useSearchWorkspace.js";
import { useAuditWorkspace } from "../composables/useAuditWorkspace.js";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const dashboard = ref({ widgets: {} });
const activePanel = ref("overview");
const error = ref("");

const panelsByRole = {
  ADMIN: ["overview", "search", "notifications", "audit"],
  CLERK: ["overview", "dock", "receiving", "putaway", "search"],
  PLANNER: ["overview", "mps", "mrp", "workorders", "adjustments", "search"],
  PLANNER_SUPERVISOR: ["overview", "mps", "mrp", "workorders", "adjustments", "search"],
  HR: ["overview", "candidates", "rules", "notifications", "search"],
  INTERVIEWER: ["overview", "candidateReview", "notifications", "search"],
  CANDIDATE: ["overview", "candidatePortal"]
};

const availablePanels = computed(() => panelsByRole[auth.role] || ["overview"]);
const displayedPanel = computed(() => {
  if (availablePanels.value.includes(activePanel.value)) {
    return activePanel.value;
  }
  return "overview";
});

function normalizePanel(rawPanel) {
  const requested = typeof rawPanel === "string" && rawPanel.trim().length > 0
    ? rawPanel.trim()
    : "overview";
  return availablePanels.value.includes(requested) ? requested : "overview";
}

function setActivePanel(nextPanel) {
  const normalized = normalizePanel(nextPanel);
  activePanel.value = normalized;
  if (route.path === "/" && route.query.panel !== normalized) {
    router.replace({ path: "/", query: { panel: normalized } });
  }
}

watch(
  () => route.query.panel,
  (queryPanel) => {
    activePanel.value = normalizePanel(queryPanel);
  },
  { immediate: true }
);

const {
  dockForm,
  receiptForm,
  isSubmittingReceipt,
  receiptCloseForm,
  receiptCloseStatus,
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
} = useReceivingWorkspace(auth);

const {
  mpsForm,
  isSavingMps,
  mrpPlanId,
  isRunningMrp,
  mrpOutput,
  workOrderForm,
  isCreatingWorkOrder,
  workOrderEventForm,
  isLoggingWorkOrderEvent,
  workOrderEventStatus,
  adjustmentForm,
  isRequestingAdjustment,
  adjustmentApproveForm,
  isApprovingAdjustment,
  adjustmentApproveStatus,
  canApproveAdjustments,
  saveMps,
  runMrp,
  createWorkOrder,
  logWorkOrderEvent,
  requestAdjustment,
  approveAdjustment
} = usePlanningWorkspace(auth);

const {
  candidateForm,
  appFormFields,
  lastCandidateId,
  candidateUploadStatus,
  scoreForm,
  interviewerReviewForm,
  interviewerReviewResult,
  interviewerReviewStatus,
  setApplicationFormFields,
  submitCandidate,
  getFormEntry,
  onCandidateFileChange,
  computeScore,
  loadInterviewerCandidate
} = useHrWorkspace();

const {
  notifForm,
  notificationQuery,
  notificationPage,
  notificationStatus,
  subscribeNotifications,
  loadNotifications
} = useNotificationsWorkspace();

const { searchForm, searchResults, searchAll } = useSearchWorkspace();

const { auditQuery, auditPage, auditStatus, loadAuditLogs } = useAuditWorkspace();

onMounted(loadDashboard);

async function loadDashboard() {
  try {
    dashboard.value = await apiRequest("/dashboard");
    const fields = await apiRequest("/hr/forms/application");
    setApplicationFormFields(fields);
  } catch (err) {
    error.value = err.message;
  }
}

async function logout() {
  await auth.logout();
  await router.push("/login");
}
</script>

<template>
  <main class="workspace-shell">
    <WorkspaceSidebar
      :user="auth.user"
      :role="auth.role"
      :panels="availablePanels"
      :active-panel="displayedPanel"
      @update:active-panel="setActivePanel"
      @logout="logout"
    />

    <section class="workspace-main">
      <header>
        <h1>{{ displayedPanel }}</h1>
        <p v-if="error" class="error">{{ error }}</p>
      </header>

      <OverviewPanel v-if="displayedPanel === 'overview'" :widgets="dashboard.widgets" />

      <DockPanel v-if="displayedPanel === 'dock'" :dock-form="dockForm" :on-submit-dock="submitDock" />

      <ReceivingPanel
        v-if="displayedPanel === 'receiving'"
        :receipt-form="receiptForm"
        :on-submit-receipt="submitReceipt"
        :is-submitting-receipt="isSubmittingReceipt"
        :receipt-close-form="receiptCloseForm"
        :receipt-close-status="receiptCloseStatus"
        :on-close-receipt="closeReceipt"
        :is-closing-receipt="isClosingReceipt"
        :receipt-document-form="receiptDocumentForm"
        :receipt-documents="receiptDocuments"
        :receipt-document-status="receiptDocumentStatus"
        :on-receipt-document-file-change="onReceiptDocumentFileChange"
        :on-upload-receipt-document="uploadReceiptDocument"
        :on-load-receipt-documents="loadReceiptDocuments"
      />

      <PutawayPanel
        v-if="displayedPanel === 'putaway'"
        :putaway-input="putawayInput"
        :putaway-result="putawayResult"
        :on-run-putaway="runPutaway"
        :is-running-putaway="isRunningPutaway"
      />

      <MpsPanel
        v-if="displayedPanel === 'mps'"
        :mps-form="mpsForm"
        :on-save-mps="saveMps"
        :is-saving-mps="isSavingMps"
      />

      <MrpPanel
        v-if="displayedPanel === 'mrp'"
        :mrp-plan-id="mrpPlanId"
        :mrp-output="mrpOutput"
        :on-run-mrp="runMrp"
        :is-running-mrp="isRunningMrp"
        @update:mrpPlanId="mrpPlanId = $event"
      />

      <WorkOrdersPanel
        v-if="displayedPanel === 'workorders'"
        :work-order-form="workOrderForm"
        :work-order-event-form="workOrderEventForm"
        :work-order-event-status="workOrderEventStatus"
        :on-create-work-order="createWorkOrder"
        :on-log-work-order-event="logWorkOrderEvent"
        :is-creating-work-order="isCreatingWorkOrder"
        :is-logging-work-order-event="isLoggingWorkOrderEvent"
      />

      <AdjustmentsPanel
        v-if="displayedPanel === 'adjustments'"
        :adjustment-form="adjustmentForm"
        :on-request-adjustment="requestAdjustment"
        :can-approve="canApproveAdjustments"
        :adjustment-approve-form="adjustmentApproveForm"
        :adjustment-approve-status="adjustmentApproveStatus"
        :on-approve-adjustment="approveAdjustment"
        :is-requesting-adjustment="isRequestingAdjustment"
        :is-approving-adjustment="isApprovingAdjustment"
      />

      <CandidateApplicationPanel
        v-if="displayedPanel === 'candidates' || displayedPanel === 'candidatePortal'"
        :candidate-form="candidateForm"
        :app-form-fields="appFormFields"
        :last-candidate-id="lastCandidateId"
        :candidate-upload-status="candidateUploadStatus"
        :on-candidate-file-change="onCandidateFileChange"
        :on-submit-candidate="submitCandidate"
        :get-form-entry="getFormEntry"
      />

      <InterviewerReviewPanel
        v-if="displayedPanel === 'candidateReview'"
        :review-form="interviewerReviewForm"
        :review-result="interviewerReviewResult"
        :review-status="interviewerReviewStatus"
        :on-load-candidate="loadInterviewerCandidate"
      />

      <RulesPanel v-if="displayedPanel === 'rules'" :score-form="scoreForm" :on-compute-score="computeScore" />

      <NotificationsPanel
        v-if="displayedPanel === 'notifications'"
        :notif-form="notifForm"
        :on-subscribe-notifications="subscribeNotifications"
        :notification-query="notificationQuery"
        :notification-page="notificationPage"
        :notification-status="notificationStatus"
        :on-load-notifications="loadNotifications"
      />

      <SearchPanel
        v-if="displayedPanel === 'search'"
        :search-form="searchForm"
        :search-results="searchResults"
        :on-search-all="searchAll"
      />

      <AuditPanel
        v-if="displayedPanel === 'audit'"
        :audit-query="auditQuery"
        :audit-page="auditPage"
        :audit-status="auditStatus"
        :on-load-audit="loadAuditLogs"
      />
    </section>
  </main>
</template>
