<script setup>
defineProps({
  mpsForm: {
    type: Object,
    required: true
  },
  onSaveMps: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>12-week MPS</h3>
    <input v-model="mpsForm.planName" placeholder="Plan name" />
    <input v-model="mpsForm.startWeek" type="date" />
    <div v-for="week in mpsForm.weeks" :key="week.weekIndex" class="row">
      <span>Week {{ week.weekIndex }}</span>
      <input v-model="week.itemCode" placeholder="Item" />
      <input v-model.number="week.plannedQty" type="number" placeholder="Qty" />
    </div>
    <button @click="onSaveMps">Save plan</button>
  </article>
</template>
