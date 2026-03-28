<script setup>
defineProps({
  workOrderForm: {
    type: Object,
    required: true
  },
  workOrderEventForm: {
    type: Object,
    required: true
  },
  workOrderEventStatus: {
    type: String,
    default: ""
  },
  onCreateWorkOrder: {
    type: Function,
    required: true
  },
  isCreatingWorkOrder: {
    type: Boolean,
    default: false
  },
  onLogWorkOrderEvent: {
    type: Function,
    required: true
  },
  isLoggingWorkOrderEvent: {
    type: Boolean,
    default: false
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Work orders</h3>
    <input v-model="workOrderForm.planId" placeholder="Plan ID" />
    <input v-model="workOrderForm.itemCode" placeholder="Item" />
    <input v-model.number="workOrderForm.qtyTarget" type="number" placeholder="Target qty" />
    <input v-model="workOrderForm.scheduledStart" type="datetime-local" />
    <input v-model="workOrderForm.scheduledEnd" type="datetime-local" />
    <button :disabled="isCreatingWorkOrder" @click="onCreateWorkOrder">
      {{ isCreatingWorkOrder ? "Creating..." : "Create work order" }}
    </button>

    <h3>Log work order event</h3>
    <input v-model="workOrderEventForm.workOrderId" placeholder="Work Order ID" />
    <select v-model="workOrderEventForm.eventType">
      <option value="PRODUCTION">Production</option>
      <option value="REWORK">Rework</option>
      <option value="DOWNTIME">Downtime</option>
    </select>
    <input v-model.number="workOrderEventForm.qty" type="number" placeholder="Quantity" />
    <input
      v-model="workOrderEventForm.reasonCode"
      :placeholder="workOrderEventForm.eventType === 'DOWNTIME' ? 'Reason code (required)' : 'Reason code (optional)'"
    />
    <textarea v-model="workOrderEventForm.notes" placeholder="Notes" />
    <button :disabled="isLoggingWorkOrderEvent" @click="onLogWorkOrderEvent">
      {{ isLoggingWorkOrderEvent ? "Logging..." : "Log event" }}
    </button>
    <p v-if="workOrderEventStatus">{{ workOrderEventStatus }}</p>
  </article>
</template>
