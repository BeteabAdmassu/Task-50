<script setup>
import { computed, onMounted, ref } from "vue";
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

const {
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
} = useReceivingWorkspace(auth);

const {
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
        :receipt-close-form="receiptCloseForm"
        :receipt-close-status="receiptCloseStatus"
        :on-close-receipt="closeReceipt"
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
        :can-approve="canApproveAdjustments"
        :adjustment-approve-form="adjustmentApproveForm"
        :adjustment-approve-status="adjustmentApproveStatus"
        :on-approve-adjustment="approveAdjustment"
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

      <InterviewerReviewPanel
        v-if="activePanel === 'candidateReview'"
        :review-form="interviewerReviewForm"
        :review-result="interviewerReviewResult"
        :review-status="interviewerReviewStatus"
        :on-load-candidate="loadInterviewerCandidate"
      />

      <RulesPanel v-if="activePanel === 'rules'" :score-form="scoreForm" :on-compute-score="computeScore" />

      <NotificationsPanel
        v-if="activePanel === 'notifications'"
        :notif-form="notifForm"
        :on-subscribe-notifications="subscribeNotifications"
        :notification-query="notificationQuery"
        :notification-page="notificationPage"
        :notification-status="notificationStatus"
        :on-load-notifications="loadNotifications"
      />

      <SearchPanel
        v-if="activePanel === 'search'"
        :search-form="searchForm"
        :search-results="searchResults"
        :on-search-all="searchAll"
      />

      <AuditPanel
        v-if="activePanel === 'audit'"
        :audit-query="auditQuery"
        :audit-page="auditPage"
        :audit-status="auditStatus"
        :on-load-audit="loadAuditLogs"
      />
    </section>
  </main>
</template>
