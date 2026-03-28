import { ref } from "vue";
import { apiFormRequest, apiRequest } from "../api.js";

export function useHrWorkspace() {
  const candidateForm = ref({ fullName: "", email: "", phone: "", dob: "", ssnLast4: "", source: "PORTAL", formData: [] });
  const appFormFields = ref([]);
  const candidateAttachment = ref(null);
  const lastCandidateId = ref("");
  const candidateUploadStatus = ref("");
  const scoreForm = ref({ candidateId: "", ruleVersionId: "", courseworkScores: [0], midtermScores: [0], finalScores: [0], creditHours: 3 });
  const interviewerReviewForm = ref({ candidateId: "" });
  const interviewerReviewResult = ref(null);
  const interviewerReviewStatus = ref("");

  function setApplicationFormFields(fields) {
    appFormFields.value = fields;
    candidateForm.value.formData = fields.map((field) => ({ fieldKey: field.field_key, fieldValue: "" }));
  }

  async function submitCandidate() {
    candidateUploadStatus.value = "";
    try {
      const created = await apiRequest("/hr/applications", { method: "POST", body: JSON.stringify(candidateForm.value) });
      lastCandidateId.value = created.id;
      if (!candidateAttachment.value) {
        candidateUploadStatus.value = "Application submitted. No attachment uploaded.";
        return;
      }

      const formData = new FormData();
      formData.append("file", candidateAttachment.value);
      const headers = {};
      if (created.uploadToken) headers["x-candidate-upload-token"] = created.uploadToken;

      try {
        await apiFormRequest(`/hr/applications/${created.id}/attachments`, formData, { headers });
        candidateUploadStatus.value = "Application and attachment uploaded successfully.";
      } catch (uploadErr) {
        candidateUploadStatus.value = `Application submitted, but attachment upload failed: ${uploadErr.message}`;
      }
    } catch (err) {
      candidateUploadStatus.value = `Application submission failed: ${err.message}`;
    }
  }

  function getFormEntry(fieldKey) {
    const found = candidateForm.value.formData.find((item) => item.fieldKey === fieldKey);
    if (found) return found;
    const created = { fieldKey, fieldValue: "" };
    candidateForm.value.formData.push(created);
    return created;
  }

  function onCandidateFileChange(event) {
    candidateAttachment.value = event.target.files?.[0] || null;
  }

  async function computeScore() {
    await apiRequest("/rules/score", { method: "POST", body: JSON.stringify(scoreForm.value) });
  }

  async function loadInterviewerCandidate() {
    interviewerReviewStatus.value = "";
    interviewerReviewResult.value = null;
    if (!interviewerReviewForm.value.candidateId) {
      interviewerReviewStatus.value = "Candidate ID is required.";
      return;
    }
    try {
      interviewerReviewResult.value = await apiRequest(`/hr/candidates/${interviewerReviewForm.value.candidateId}`);
      interviewerReviewStatus.value = "Candidate loaded.";
    } catch (err) {
      interviewerReviewStatus.value = `Unable to load candidate: ${err.message}`;
    }
  }

  return {
    candidateForm,
    appFormFields,
    lastCandidateId,
    candidateUploadStatus,
    scoreForm,
    interviewerReviewForm,
    interviewerReviewResult,
    interviewerReviewStatus,
    setApplicationFormFields,
    submitCandidate,
    getFormEntry,
    onCandidateFileChange,
    computeScore,
    loadInterviewerCandidate
  };
}
