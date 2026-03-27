<script setup>
defineProps({
  mrpPlanId: {
    type: String,
    default: ""
  },
  mrpOutput: {
    type: Array,
    default: () => []
  },
  onRunMrp: {
    type: Function,
    required: true
  }
});

const emit = defineEmits(["update:mrpPlanId"]);
</script>

<template>
  <article class="card form-grid">
    <h3>MRP</h3>
    <input :value="mrpPlanId" @input="emit('update:mrpPlanId', $event.target.value)" placeholder="Plan ID" />
    <button @click="onRunMrp">Run MRP</button>
    <pre>{{ mrpOutput }}</pre>
  </article>
</template>
