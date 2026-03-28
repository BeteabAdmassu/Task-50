import { beforeEach, test, expect, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";

vi.mock("../src/api.js", () => ({
  apiRequest: vi.fn(async (path) => {
    if (path === "/dashboard") {
      return { widgets: { openReceipts: 3 } };
    }
    if (path === "/hr/forms/application") {
      return [];
    }
    return {};
  }),
  apiFormRequest: vi.fn(async () => ({}))
}));

import WorkspaceView from "../src/views/WorkspaceView.vue";
import { useAuthStore } from "../src/stores/auth.js";

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
});

test("workspace shows clerk role panels", async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const auth = useAuthStore();
  auth.token = "token-1";
  auth.user = { id: 4, username: "clerk1", role: "CLERK", siteId: 1 };

  const wrapper = mount(WorkspaceView, {
    global: {
      plugins: [pinia]
    }
  });

  await flushPromises();

  const panelButtons = wrapper
    .findAll("aside.workspace-nav button")
    .map((button) => button.text().trim())
    .filter((name) => name && name !== "Logout");

  expect(panelButtons).toContain("receiving");
  expect(panelButtons).toContain("dock");
  expect(panelButtons).not.toContain("notifications");
});
