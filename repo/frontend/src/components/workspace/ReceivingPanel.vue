<script setup>
defineProps({
  receiptForm: {
    type: Object,
    required: true
  },
  onSubmitReceipt: {
    type: Function,
    required: true
  },
  isSubmittingReceipt: {
    type: Boolean,
    default: false
  },
  receiptCloseForm: {
    type: Object,
    required: true
  },
  receiptCloseStatus: {
    type: String,
    default: ""
  },
  onCloseReceipt: {
    type: Function,
    required: true
  },
  isClosingReceipt: {
    type: Boolean,
    default: false
  },
  receiptDocumentForm: {
    type: Object,
    required: true
  },
  receiptDocuments: {
    type: Array,
    default: () => []
  },
  receiptDocumentStatus: {
    type: String,
    default: ""
  },
  onReceiptDocumentFileChange: {
    type: Function,
    required: true
  },
  onUploadReceiptDocument: {
    type: Function,
    required: true
  },
  onLoadReceiptDocuments: {
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
      <input v-model="line.batchNo" placeholder="Batch" />
      <input v-model.number="line.qtyExpected" type="number" placeholder="Expected" />
      <input v-model.number="line.qtyReceived" type="number" placeholder="Received" />
      <select v-model="line.inspectionStatus">
        <option value="PENDING">Inspection pending</option>
        <option value="PASS">Pass</option>
        <option value="FAIL">Fail</option>
      </select>
      <select v-model="line.discrepancyType">
        <option value="">No discrepancy</option>
        <option value="OVER">Over</option>
        <option value="SHORT">Short</option>
        <option value="DAMAGED">Damaged</option>
      </select>
      <input v-model="line.dispositionNote" placeholder="Disposition note" />
    </div>
    <button :disabled="isSubmittingReceipt" @click="onSubmitReceipt">
      {{ isSubmittingReceipt ? "Creating..." : "Create receipt" }}
    </button>

    <h3>Close receipt</h3>
    <input v-model="receiptCloseForm.receiptId" placeholder="Receipt ID" />
    <button :disabled="isClosingReceipt" @click="onCloseReceipt">
      {{ isClosingReceipt ? "Closing..." : "Close receipt" }}
    </button>
    <p v-if="receiptCloseStatus">{{ receiptCloseStatus }}</p>

    <h3>Receipt documents</h3>
    <input v-model="receiptDocumentForm.receiptId" placeholder="Receipt ID" />
    <input v-model="receiptDocumentForm.poLineNo" placeholder="PO Line (optional)" />
    <input v-model="receiptDocumentForm.lotNo" placeholder="Lot (optional)" />
    <input v-model="receiptDocumentForm.batchNo" placeholder="Batch (optional)" />
    <input v-model="receiptDocumentForm.storageLocationId" placeholder="Storage Location ID (optional)" />
    <input v-model="receiptDocumentForm.title" placeholder="Document title (optional)" />
    <input type="file" accept=".pdf,image/png,image/jpeg" @change="onReceiptDocumentFileChange" />
    <div class="row">
      <button @click="onUploadReceiptDocument">Upload document</button>
      <button @click="onLoadReceiptDocuments">Load documents</button>
    </div>
    <p v-if="receiptDocumentStatus">{{ receiptDocumentStatus }}</p>
    <ul v-if="receiptDocuments.length">
      <li v-for="doc in receiptDocuments" :key="doc.id">
        {{ doc.original_name }} ({{ doc.mime_type }})
      </li>
    </ul>
  </article>
</template>
