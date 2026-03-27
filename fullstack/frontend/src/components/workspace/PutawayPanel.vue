<script setup>
defineProps({
  putawayInput: {
    type: Object,
    required: true
  },
  putawayResult: {
    type: Object,
    default: null
  },
  onRunPutaway: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Putaway recommendation</h3>
    <input v-model="putawayInput.sku" placeholder="SKU" />
    <input v-model="putawayInput.lotNo" placeholder="Lot" />
    <input v-model.number="putawayInput.quantity" type="number" placeholder="Quantity" />
    <button @click="onRunPutaway">Recommend bin</button>
    <pre v-if="putawayResult">{{ putawayResult }}</pre>
  </article>
</template>
