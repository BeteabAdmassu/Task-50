<script setup>
defineProps({
  dockForm: {
    type: Object,
    required: true
  },
  onSubmitDock: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Dock scheduling (30 minutes)</h3>
    <input v-model="dockForm.siteId" placeholder="Site ID" />
    <input v-model="dockForm.poNumber" placeholder="PO Number" />
    <input v-model="dockForm.startAt" type="datetime-local" />
    <input v-model="dockForm.endAt" type="datetime-local" />
    <textarea v-model="dockForm.notes" placeholder="Notes" />
    <button @click="onSubmitDock">Save appointment</button>
  </article>
</template>
