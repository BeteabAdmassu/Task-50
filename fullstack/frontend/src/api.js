const runtimeBase = `${window.location.protocol}//${window.location.hostname}:4000/api`;
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || runtimeBase).replace(/\/$/, "");

export async function apiRequest(path, options = {}) {
  const token = localStorage.getItem("forgeops_token");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

export async function apiFormRequest(path, formData, options = {}) {
  const token = localStorage.getItem("forgeops_token");
  const headers = {
    ...(options.headers || {})
  };
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    method: options.method || "POST",
    headers,
    body: formData
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}
