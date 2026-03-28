import { ref } from "vue";
import { apiRequest } from "../api.js";

export function useNotificationsWorkspace() {
  const notifForm = ref({ topic: "RECEIPT_ACK", frequency: "IMMEDIATE", dndStart: "21:00", dndEnd: "07:00" });
  const notificationQuery = ref({ status: "", eventType: "", page: 1, pageSize: 20 });
  const notificationPage = ref({ page: 1, pageSize: 20, total: 0, data: [] });
  const notificationStatus = ref("");

  async function subscribeNotifications() {
    await apiRequest("/notifications/subscriptions", { method: "POST", body: JSON.stringify(notifForm.value) });
  }

  async function loadNotifications() {
    notificationStatus.value = "";
    try {
      const params = new URLSearchParams(notificationQuery.value).toString();
      notificationPage.value = await apiRequest(`/notifications?${params}`);
      notificationStatus.value = "Notifications loaded.";
    } catch (err) {
      notificationStatus.value = `Failed to load notifications: ${err.message}`;
    }
  }

  return {
    notifForm,
    notificationQuery,
    notificationPage,
    notificationStatus,
    subscribeNotifications,
    loadNotifications
  };
}
