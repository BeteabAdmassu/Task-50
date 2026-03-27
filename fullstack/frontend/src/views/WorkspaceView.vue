<script setup>
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "../stores/auth.js";
import { apiRequest } from "../api.js";

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
const scoreForm = ref({ candidateId: "", ruleVersionId: "", courseworkScores: [0], midtermScores: [0], finalScores: [0], creditHours: 3 });
const notifForm = ref({ topic: "RECEIPT_ACK", frequency: "IMMEDIATE" });
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
  const created = await apiRequest("/hr/applications", { method: "POST", body: JSON.stringify(candidateForm.value) });
  lastCandidateId.value = created.id;
  if (candidateAttachment.value) {
    const formData = new FormData();
    formData.append("file", candidateAttachment.value);
    const token = localStorage.getItem("forgeops_token");
    await fetch(`http://localhost:4000/api/hr/applications/${created.id}/attachments`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData
    });
  }
}

function getFormEntry(fieldKey) {
  const found = candidateForm.value.formData.find((item) => item.fieldKey === fieldKey);
  if (found) return found;
  const created = { fieldKey, fieldValue: "" };
  candidateForm.value.formData.push(created);
  return created;
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
    <aside class="workspace-nav">
      <h2>ForgeOps Hub</h2>
      <p>{{ auth.user?.username }} · {{ auth.role }}</p>
      <button v-for="panel in availablePanels" :key="panel" @click="activePanel = panel" :class="{ active: activePanel === panel }">
        {{ panel }}
      </button>
      <button class="logout" @click="logout">Logout</button>
    </aside>

    <section class="workspace-main">
      <header>
        <h1>{{ activePanel }}</h1>
        <p v-if="error" class="error">{{ error }}</p>
      </header>

      <article v-if="activePanel === 'overview'" class="card">
        <h3>Quick stats</h3>
        <pre>{{ dashboard.widgets }}</pre>
      </article>

      <article v-if="activePanel === 'dock'" class="card form-grid">
        <h3>Dock scheduling (30 minutes)</h3>
        <input v-model="dockForm.siteId" placeholder="Site ID" />
        <input v-model="dockForm.poNumber" placeholder="PO Number" />
        <input v-model="dockForm.startAt" type="datetime-local" />
        <input v-model="dockForm.endAt" type="datetime-local" />
        <textarea v-model="dockForm.notes" placeholder="Notes" />
        <button @click="submitDock">Save appointment</button>
      </article>

      <article v-if="activePanel === 'receiving'" class="card form-grid">
        <h3>PO receipt and inspection</h3>
        <input v-model="receiptForm.siteId" placeholder="Site ID" />
        <input v-model="receiptForm.poNumber" placeholder="PO Number" />
        <div v-for="line in receiptForm.lines" :key="line.poLineNo" class="row">
          <input v-model="line.poLineNo" placeholder="PO Line" />
          <input v-model="line.sku" placeholder="SKU" />
          <input v-model="line.lotNo" placeholder="Lot" />
          <input v-model.number="line.qtyExpected" type="number" placeholder="Expected" />
          <input v-model.number="line.qtyReceived" type="number" placeholder="Received" />
          <select v-model="line.discrepancyType">
            <option value="">No discrepancy</option>
            <option value="OVER">Over</option>
            <option value="SHORT">Short</option>
            <option value="DAMAGED">Damaged</option>
          </select>
          <input v-model="line.dispositionNote" placeholder="Disposition note" />
        </div>
        <button @click="submitReceipt">Create receipt</button>
      </article>

      <article v-if="activePanel === 'putaway'" class="card form-grid">
        <h3>Putaway recommendation</h3>
        <input v-model="putawayInput.sku" placeholder="SKU" />
        <input v-model="putawayInput.lotNo" placeholder="Lot" />
        <input v-model.number="putawayInput.quantity" type="number" placeholder="Quantity" />
        <button @click="runPutaway">Recommend bin</button>
        <pre v-if="putawayResult">{{ putawayResult }}</pre>
      </article>

      <article v-if="activePanel === 'mps'" class="card form-grid">
        <h3>12-week MPS</h3>
        <input v-model="mpsForm.planName" placeholder="Plan name" />
        <input v-model="mpsForm.startWeek" type="date" />
        <div v-for="week in mpsForm.weeks" :key="week.weekIndex" class="row">
          <span>Week {{ week.weekIndex }}</span>
          <input v-model="week.itemCode" placeholder="Item" />
          <input v-model.number="week.plannedQty" type="number" placeholder="Qty" />
        </div>
        <button @click="saveMps">Save plan</button>
      </article>

      <article v-if="activePanel === 'mrp'" class="card form-grid">
        <h3>MRP</h3>
        <input v-model="mrpPlanId" placeholder="Plan ID" />
        <button @click="runMrp">Run MRP</button>
        <pre>{{ mrpOutput }}</pre>
      </article>

      <article v-if="activePanel === 'workorders'" class="card form-grid">
        <h3>Work orders</h3>
        <input v-model="workOrderForm.planId" placeholder="Plan ID" />
        <input v-model="workOrderForm.itemCode" placeholder="Item" />
        <input v-model.number="workOrderForm.qtyTarget" type="number" placeholder="Target qty" />
        <input v-model="workOrderForm.scheduledStart" type="datetime-local" />
        <input v-model="workOrderForm.scheduledEnd" type="datetime-local" />
        <button @click="createWorkOrder">Create work order</button>

        <h3>Log work order event</h3>
        <input v-model="workOrderEventForm.workOrderId" placeholder="Work Order ID" />
        <select v-model="workOrderEventForm.eventType">
          <option value="PRODUCTION">Production</option>
          <option value="REWORK">Rework</option>
          <option value="DOWNTIME">Downtime</option>
        </select>
        <input v-model.number="workOrderEventForm.qty" type="number" placeholder="Quantity" />
        <input
          v-model="workOrderEventForm.reasonCode"
          :placeholder="workOrderEventForm.eventType === 'DOWNTIME' ? 'Reason code (required)' : 'Reason code (optional)'"
        />
        <textarea v-model="workOrderEventForm.notes" placeholder="Notes" />
        <button @click="logWorkOrderEvent">Log event</button>
        <p v-if="workOrderEventStatus">{{ workOrderEventStatus }}</p>
      </article>

      <article v-if="activePanel === 'adjustments'" class="card form-grid">
        <h3>Plan adjustment</h3>
        <input v-model="adjustmentForm.planId" placeholder="Plan ID" />
        <input v-model="adjustmentForm.reasonCode" placeholder="Reason code" />
        <textarea v-model="adjustmentForm.before" placeholder="Before JSON" />
        <textarea v-model="adjustmentForm.after" placeholder="After JSON" />
        <button @click="requestAdjustment">Submit for approval</button>
      </article>

      <article v-if="activePanel === 'candidates' || activePanel === 'candidatePortal'" class="card form-grid">
        <h3>Candidate application</h3>
        <input v-model="candidateForm.fullName" placeholder="Full name" />
        <input v-model="candidateForm.email" placeholder="Email" />
        <input v-model="candidateForm.phone" placeholder="Phone" />
        <input v-model="candidateForm.dob" type="date" />
        <input v-model="candidateForm.ssnLast4" placeholder="SSN last 4" maxlength="4" />
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" @change="(e) => (candidateAttachment.value = e.target.files?.[0] || null)" />
        <div v-for="field in appFormFields" :key="field.field_key">
          <input
            v-model="getFormEntry(field.field_key).fieldValue"
            :placeholder="`${field.label}${field.is_required ? ' *' : ''}`"
          />
        </div>
        <button @click="submitCandidate">Submit application</button>
        <p v-if="lastCandidateId">Application ID: {{ lastCandidateId }}</p>
      </article>

      <article v-if="activePanel === 'rules'" class="card form-grid">
        <h3>Qualification scoring</h3>
        <input v-model="scoreForm.candidateId" placeholder="Candidate ID" />
        <input v-model="scoreForm.ruleVersionId" placeholder="Rule version ID" />
        <input v-model.number="scoreForm.courseworkScores[0]" type="number" placeholder="Coursework" />
        <input v-model.number="scoreForm.midtermScores[0]" type="number" placeholder="Midterm" />
        <input v-model.number="scoreForm.finalScores[0]" type="number" placeholder="Final" />
        <input v-model.number="scoreForm.creditHours" type="number" placeholder="Credit hours" />
        <button @click="computeScore">Compute score</button>
      </article>

      <article v-if="activePanel === 'notifications'" class="card form-grid">
        <h3>Notifications</h3>
        <select v-model="notifForm.topic">
          <option value="TICKET_UPDATE">Ticket updates</option>
          <option value="REVIEW_OUTCOME">Review outcomes</option>
          <option value="ADOPTION_FOLLOWUP">Adoption follow-ups</option>
          <option value="RECEIPT_ACK">Receipt acknowledgments</option>
        </select>
        <select v-model="notifForm.frequency">
          <option value="IMMEDIATE">Immediate</option>
          <option value="HOURLY">Hourly digest</option>
          <option value="DAILY">Daily 6 PM</option>
        </select>
        <button @click="subscribeNotifications">Save subscription</button>
      </article>

      <article v-if="activePanel === 'search'" class="card form-grid">
        <h3>Global search</h3>
        <input v-model="searchForm.q" placeholder="Title, body, tags" />
        <input v-model="searchForm.source" placeholder="Source" />
        <input v-model="searchForm.topic" placeholder="Topic" />
        <input v-model="searchForm.entityType" placeholder="Entity" />
        <input v-model="searchForm.startDate" type="date" />
        <input v-model="searchForm.endDate" type="date" />
        <button @click="searchAll">Search</button>
        <pre>{{ searchResults }}</pre>
      </article>

      <article v-if="activePanel === 'audit'" class="card">
        <p>Audit trail is immutable and captured in backend table <code>audit_logs</code>.</p>
      </article>
    </section>
  </main>
</template>
