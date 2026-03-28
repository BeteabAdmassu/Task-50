import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "./stores/auth.js";
import LoginView from "./views/LoginView.vue";
import WorkspaceView from "./views/WorkspaceView.vue";

const rolePanels = {
  ADMIN: new Set(["overview", "search", "notifications", "audit"]),
  CLERK: new Set(["overview", "dock", "receiving", "putaway", "search"]),
  PLANNER: new Set(["overview", "mps", "mrp", "workorders", "adjustments", "search"]),
  PLANNER_SUPERVISOR: new Set(["overview", "mps", "mrp", "workorders", "adjustments", "search"]),
  HR: new Set(["overview", "candidates", "rules", "notifications", "search"]),
  INTERVIEWER: new Set(["overview", "candidateReview", "notifications", "search"]),
  CANDIDATE: new Set(["overview", "candidatePortal"])
};

function requestedPanel(to) {
  const raw = to.query?.panel;
  if (typeof raw !== "string" || raw.trim().length === 0) return "overview";
  return raw.trim();
}

const routes = [
  { path: "/login", name: "login", component: LoginView },
  { path: "/", name: "workspace", component: WorkspaceView, meta: { auth: true } }
];

const router = createRouter({
  history: createWebHistory(),
  routes
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.auth && !auth.user && auth.token) {
    await auth.bootstrap();
  }
  if (to.meta.auth && !auth.isAuthenticated) {
    return "/login";
  }
  if (to.meta.auth) {
    const allowedPanels = rolePanels[auth.role];
    if (!allowedPanels) {
      await auth.logout();
      return "/login";
    }
    const panel = requestedPanel(to);
    if (!allowedPanels.has(panel)) {
      return { path: "/", query: { panel: "overview" } };
    }
  }
  if (to.path === "/login" && auth.isAuthenticated) {
    return "/";
  }
  return true;
});

export default router;
