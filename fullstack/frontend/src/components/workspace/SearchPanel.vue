<script setup>
defineProps({
  searchForm: {
    type: Object,
    required: true
  },
  searchResults: {
    type: Array,
    default: () => []
  },
  onSearchAll: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Global search</h3>
    <input v-model="searchForm.q" placeholder="Title, body, tags" />
    <input v-model="searchForm.source" placeholder="Source" />
    <input v-model="searchForm.topic" placeholder="Topic" />
    <input v-model="searchForm.entityType" placeholder="Entity" />
    <input v-model="searchForm.startDate" type="date" />
    <input v-model="searchForm.endDate" type="date" />
    <button @click="onSearchAll">Search</button>
    <pre>{{ searchResults }}</pre>
  </article>
</template>
