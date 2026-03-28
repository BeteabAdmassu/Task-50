<script setup>
defineProps({
  adjustmentForm: {
    type: Object,
    required: true
  },
  onRequestAdjustment: {
    type: Function,
    required: true
  },
  isRequestingAdjustment: {
    type: Boolean,
    default: false
  },
  canApprove: {
    type: Boolean,
    default: false
  },
  adjustmentApproveForm: {
    type: Object,
    required: true
  },
  adjustmentApproveStatus: {
    type: String,
    default: ""
  },
  onApproveAdjustment: {
    type: Function,
    required: true
  },
  isApprovingAdjustment: {
    type: Boolean,
    default: false
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
    <button :disabled="isRequestingAdjustment" @click="onRequestAdjustment">
      {{ isRequestingAdjustment ? "Submitting..." : "Submit for approval" }}
    </button>

    <template v-if="canApprove">
      <h3>Approve plan adjustment</h3>
      <input v-model="adjustmentApproveForm.adjustmentId" placeholder="Adjustment ID" />
      <button :disabled="isApprovingAdjustment" @click="onApproveAdjustment">
        {{ isApprovingAdjustment ? "Approving..." : "Approve adjustment" }}
      </button>
      <p v-if="adjustmentApproveStatus">{{ adjustmentApproveStatus }}</p>
    </template>
  </article>
</template>
