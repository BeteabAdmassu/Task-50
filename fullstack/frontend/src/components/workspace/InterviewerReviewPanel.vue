<script setup>
defineProps({
  reviewForm: {
    type: Object,
    required: true
  },
  reviewResult: {
    type: Object,
    default: null
  },
  reviewStatus: {
    type: String,
    default: ""
  },
  onLoadCandidate: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Assigned candidate review</h3>
    <input v-model="reviewForm.candidateId" placeholder="Candidate ID" />
    <button @click="onLoadCandidate">Load candidate</button>
    <p v-if="reviewStatus">{{ reviewStatus }}</p>
    <pre v-if="reviewResult">{{ reviewResult }}</pre>
  </article>
</template>
