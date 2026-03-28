import { ref } from "vue";
import { apiRequest } from "../api.js";

export function useAuditWorkspace() {
  const auditQuery = ref({ action: "", entityType: "", actorUserId: "", page: 1, pageSize: 20 });
  const auditPage = ref({ page: 1, pageSize: 20, total: 0, data: [] });
  const auditStatus = ref("");

  async function loadAuditLogs() {
    auditStatus.value = "";
    try {
      const params = new URLSearchParams(auditQuery.value).toString();
      auditPage.value = await apiRequest(`/audit?${params}`);
      auditStatus.value = "Audit logs loaded.";
    } catch (err) {
      auditStatus.value = `Failed to load audit logs: ${err.message}`;
    }
  }

  return {
    auditQuery,
    auditPage,
    auditStatus,
    loadAuditLogs
  };
}
