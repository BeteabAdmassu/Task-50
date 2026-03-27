<script setup>
defineProps({
  notifForm: {
    type: Object,
    required: true
  },
  onSubscribeNotifications: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Notifications</h3>
    <select v-model="notifForm.topic">
      <option value="TICKET_UPDATE">Ticket updates</option>
      <option value="REVIEW_OUTCOME">Review outcomes</option>
      <option value="ADOPTION_FOLLOWUP">Adoption follow-ups</option>
      <option value="RECEIPT_ACK">Receipt acknowledgments</option>
    </select>
    <select v-model="notifForm.frequency">
      <option value="IMMEDIATE">Immediate</option>
      <option value="HOURLY">Hourly digest</option>
      <option value="DAILY">Daily 6 PM</option>
    </select>
    <button @click="onSubscribeNotifications">Save subscription</button>
  </article>
</template>
