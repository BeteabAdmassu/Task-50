<script setup>
defineProps({
  scoreForm: {
    type: Object,
    required: true
  },
  onComputeScore: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Qualification scoring</h3>
    <input v-model="scoreForm.candidateId" placeholder="Candidate ID" />
    <input v-model="scoreForm.ruleVersionId" placeholder="Rule version ID" />
    <input v-model.number="scoreForm.courseworkScores[0]" type="number" placeholder="Coursework" />
    <input v-model.number="scoreForm.midtermScores[0]" type="number" placeholder="Midterm" />
    <input v-model.number="scoreForm.finalScores[0]" type="number" placeholder="Final" />
    <input v-model.number="scoreForm.creditHours" type="number" placeholder="Credit hours" />
    <button @click="onComputeScore">Compute score</button>
  </article>
</template>
