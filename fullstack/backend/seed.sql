INSERT INTO permissions (code, description) VALUES
  ('DOCK_APPOINTMENT_WRITE', 'Create and modify dock appointments'),
  ('RECEIPT_WRITE', 'Create and update receipts'),
  ('RECEIPT_CLOSE', 'Close receipts'),
  ('PUTAWAY_READ', 'Get putaway recommendations'),
  ('MPS_WRITE', 'Create and edit production plans'),
  ('MRP_RUN', 'Run MRP calculations'),
  ('WORK_ORDER_WRITE', 'Create and update work orders'),
  ('PLAN_ADJUST', 'Submit production plan adjustments'),
  ('PLAN_APPROVE', 'Approve production plan adjustments'),
  ('CANDIDATE_READ', 'Read candidate profiles'),
  ('NOTIFY_PUBLISH', 'Publish notifications'),
  ('MESSAGE_QUEUE', 'Manage offline message queue'),
  ('RULES_WRITE', 'Manage scoring rules'),
  ('RULES_SCORE', 'Calculate qualification scores'),
  ('SENSITIVE_DATA_VIEW', 'View unmasked sensitive candidate fields')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_code, permission_id)
SELECT 'ADMIN', p.id FROM permissions p
ON DUPLICATE KEY UPDATE role_code = role_code;

INSERT INTO role_permissions (role_code, permission_id)
SELECT 'CLERK', p.id FROM permissions p WHERE p.code IN ('DOCK_APPOINTMENT_WRITE', 'RECEIPT_WRITE', 'RECEIPT_CLOSE', 'PUTAWAY_READ')
ON DUPLICATE KEY UPDATE role_code = role_code;

INSERT INTO role_permissions (role_code, permission_id)
SELECT 'PLANNER', p.id FROM permissions p WHERE p.code IN ('MPS_WRITE', 'MRP_RUN', 'WORK_ORDER_WRITE', 'PLAN_ADJUST')
ON DUPLICATE KEY UPDATE role_code = role_code;

INSERT INTO role_permissions (role_code, permission_id)
SELECT 'PLANNER_SUPERVISOR', p.id FROM permissions p WHERE p.code IN ('MPS_WRITE', 'MRP_RUN', 'WORK_ORDER_WRITE', 'PLAN_ADJUST', 'PLAN_APPROVE')
ON DUPLICATE KEY UPDATE role_code = role_code;

INSERT INTO role_permissions (role_code, permission_id)
SELECT 'HR', p.id FROM permissions p WHERE p.code IN ('CANDIDATE_READ', 'NOTIFY_PUBLISH', 'RULES_WRITE', 'RULES_SCORE', 'SENSITIVE_DATA_VIEW')
ON DUPLICATE KEY UPDATE role_code = role_code;

INSERT INTO role_permissions (role_code, permission_id)
SELECT 'INTERVIEWER', p.id FROM permissions p WHERE p.code IN ('CANDIDATE_READ')
ON DUPLICATE KEY UPDATE role_code = role_code;

INSERT INTO notification_templates (topic, title_template, body_template) VALUES
  ('TICKET_UPDATE', 'Ticket updated', 'Ticket {ticketId} updated to {status}'),
  ('REVIEW_OUTCOME', 'Review completed', 'Candidate {candidateName} review outcome: {outcome}'),
  ('ADOPTION_FOLLOWUP', 'Adoption follow-up', '{owner} has pending follow-up: {topic}'),
  ('RECEIPT_ACK', 'Receipt acknowledgment', 'Receipt {receiptId} acknowledged for PO {poNumber}')
ON DUPLICATE KEY UPDATE body_template = VALUES(body_template);

INSERT INTO application_form_fields (field_key, label, field_type, is_required, sort_order) VALUES
  ('work_eligibility', 'Work Eligibility', 'select', 1, 1),
  ('years_experience', 'Years of Experience', 'number', 1, 2),
  ('preferred_shift', 'Preferred Shift', 'select', 0, 3)
ON DUPLICATE KEY UPDATE label = VALUES(label), field_type = VALUES(field_type), is_required = VALUES(is_required), sort_order = VALUES(sort_order);

INSERT INTO application_attachment_requirements (classification, is_required, applies_to_source) VALUES
  ('RESUME', 1, NULL),
  ('IDENTITY_DOC', 1, NULL)
ON DUPLICATE KEY UPDATE is_required = VALUES(is_required), applies_to_source = VALUES(applies_to_source);
