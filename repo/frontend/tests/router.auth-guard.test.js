import { beforeEach, test, expect } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import router from "../src/router.js";
import { useAuthStore } from "../src/stores/auth.js";

beforeEach(async () => {
  setActivePinia(createPinia());
  localStorage.clear();
  const auth = useAuthStore();
  auth.token = null;
  auth.user = null;
  await router.replace("/login");
});

test("redirects unauthenticated user to /login", async () => {
  await router.push("/");
  expect(router.currentRoute.value.path).toBe("/login");
});

test("allows authenticated user to access /", async () => {
  const auth = useAuthStore();
  auth.token = "token-1";
  auth.user = { id: 1, username: "admin", role: "ADMIN" };

  await router.push("/");
  expect(router.currentRoute.value.path).toBe("/");
});

test("redirects authenticated user away from unauthorized panel query", async () => {
  const auth = useAuthStore();
  auth.token = "token-2";
  auth.user = { id: 2, username: "clerk1", role: "CLERK" };

  await router.push({ path: "/", query: { panel: "audit" } });
  expect(router.currentRoute.value.path).toBe("/");
  expect(router.currentRoute.value.query.panel).toBe("overview");
});
