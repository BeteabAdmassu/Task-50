import { ref } from "vue";
import { apiRequest } from "../api.js";

export function useSearchWorkspace() {
  const searchForm = ref({ q: "", source: "", topic: "", entityType: "", startDate: "", endDate: "" });
  const searchResults = ref([]);

  async function searchAll() {
    const params = new URLSearchParams(searchForm.value).toString();
    searchResults.value = await apiRequest(`/search?${params}`);
  }

  return {
    searchForm,
    searchResults,
    searchAll
  };
}
