<script setup>
defineProps({
  adjustmentForm: {
    type: Object,
    required: true
  },
  onRequestAdjustment: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Plan adjustment</h3>
    <input v-model="adjustmentForm.planId" placeholder="Plan ID" />
    <input v-model="adjustmentForm.reasonCode" placeholder="Reason code" />
    <textarea v-model="adjustmentForm.before" placeholder="Before JSON" />
    <textarea v-model="adjustmentForm.after" placeholder="After JSON" />
    <button @click="onRequestAdjustment">Submit for approval</button>
  </article>
</template>
