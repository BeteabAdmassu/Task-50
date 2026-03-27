<script setup>
defineProps({
  candidateForm: {
    type: Object,
    required: true
  },
  appFormFields: {
    type: Array,
    default: () => []
  },
  lastCandidateId: {
    type: [String, Number],
    default: ""
  },
  candidateUploadStatus: {
    type: String,
    default: ""
  },
  onCandidateFileChange: {
    type: Function,
    required: true
  },
  onSubmitCandidate: {
    type: Function,
    required: true
  },
  getFormEntry: {
    type: Function,
    required: true
  }
});
</script>

<template>
  <article class="card form-grid">
    <h3>Candidate application</h3>
    <input v-model="candidateForm.fullName" placeholder="Full name" />
    <input v-model="candidateForm.email" placeholder="Email" />
    <input v-model="candidateForm.phone" placeholder="Phone" />
    <input v-model="candidateForm.dob" type="date" />
    <input v-model="candidateForm.ssnLast4" placeholder="SSN last 4" maxlength="4" />
    <input type="file" accept=".pdf,.jpg,.jpeg,.png" @change="onCandidateFileChange" />
    <div v-for="field in appFormFields" :key="field.field_key">
      <input
        v-model="getFormEntry(field.field_key).fieldValue"
        :placeholder="`${field.label}${field.is_required ? ' *' : ''}`"
      />
    </div>
    <button @click="onSubmitCandidate">Submit application</button>
    <p v-if="lastCandidateId">Application ID: {{ lastCandidateId }}</p>
    <p v-if="candidateUploadStatus">{{ candidateUploadStatus }}</p>
  </article>
</template>
