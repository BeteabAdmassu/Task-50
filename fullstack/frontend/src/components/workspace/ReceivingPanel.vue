<script setup>
defineProps({
  receiptForm: {
    type: Object,
    required: true
  },
  onSubmitReceipt: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>PO receipt and inspection</h3>
    <input v-model="receiptForm.siteId" placeholder="Site ID" />
    <input v-model="receiptForm.poNumber" placeholder="PO Number" />
    <div v-for="line in receiptForm.lines" :key="line.poLineNo" class="row">
      <input v-model="line.poLineNo" placeholder="PO Line" />
      <input v-model="line.sku" placeholder="SKU" />
      <input v-model="line.lotNo" placeholder="Lot" />
      <input v-model.number="line.qtyExpected" type="number" placeholder="Expected" />
      <input v-model.number="line.qtyReceived" type="number" placeholder="Received" />
      <select v-model="line.discrepancyType">
        <option value="">No discrepancy</option>
        <option value="OVER">Over</option>
        <option value="SHORT">Short</option>
        <option value="DAMAGED">Damaged</option>
      </select>
      <input v-model="line.dispositionNote" placeholder="Disposition note" />
    </div>
    <button @click="onSubmitReceipt">Create receipt</button>
  </article>
</template>
