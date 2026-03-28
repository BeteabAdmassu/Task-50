CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL UNIQUE,
  role VARCHAR(40) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  site_id BIGINT NULL,
  department_id BIGINT NULL,
  sensitive_data_view TINYINT(1) NOT NULL DEFAULT 0,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(36) PRIMARY KEY,
  user_id BIGINT NOT NULL,
  issued_at DATETIME NOT NULL,
  last_activity_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code VARCHAR(40) NOT NULL,
  permission_id BIGINT NOT NULL,
  PRIMARY KEY (role_code, permission_id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id)
);

CREATE TABLE IF NOT EXISTS organizations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  organization_id BIGINT NOT NULL,
  name VARCHAR(120) NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE TABLE IF NOT EXISTS dock_appointments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  site_id BIGINT NOT NULL,
  po_number VARCHAR(80) NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL,
  notes TEXT NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receipts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  site_id BIGINT NOT NULL,
  po_number VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL,
  received_by BIGINT NOT NULL,
  closed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receipt_lines (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  receipt_id BIGINT NOT NULL,
  po_line_no VARCHAR(40) NOT NULL,
  sku VARCHAR(80) NOT NULL,
  lot_no VARCHAR(80) NULL,
  batch_no VARCHAR(80) NULL,
  qty_expected DECIMAL(18,4) NOT NULL,
  qty_received DECIMAL(18,4) NOT NULL,
  inspection_status VARCHAR(30) NOT NULL,
  storage_location_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS receipt_documents (
  id VARCHAR(36) PRIMARY KEY,
  receipt_id BIGINT NOT NULL,
  po_line_no VARCHAR(40) NULL,
  lot_no VARCHAR(80) NULL,
  batch_no VARCHAR(80) NULL,
  storage_location_id BIGINT NULL,
  title VARCHAR(255) NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL,
  uploaded_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

SET @has_receipt_line_batch = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'receipt_lines'
    AND column_name = 'batch_no'
);
SET @receipt_line_batch_sql = IF(
  @has_receipt_line_batch = 0,
  'ALTER TABLE receipt_lines ADD COLUMN batch_no VARCHAR(80) NULL AFTER lot_no',
  'SELECT 1'
);
PREPARE receipt_line_batch_stmt FROM @receipt_line_batch_sql;
EXECUTE receipt_line_batch_stmt;
DEALLOCATE PREPARE receipt_line_batch_stmt;

SET @has_receipt_document_batch = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'receipt_documents'
    AND column_name = 'batch_no'
);
SET @receipt_document_batch_sql = IF(
  @has_receipt_document_batch = 0,
  'ALTER TABLE receipt_documents ADD COLUMN batch_no VARCHAR(80) NULL AFTER lot_no',
  'SELECT 1'
);
PREPARE receipt_document_batch_stmt FROM @receipt_document_batch_sql;
EXECUTE receipt_document_batch_stmt;
DEALLOCATE PREPARE receipt_document_batch_stmt;

CREATE TABLE IF NOT EXISTS receipt_discrepancies (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  receipt_id BIGINT NOT NULL,
  po_line_no VARCHAR(40) NOT NULL,
  discrepancy_type VARCHAR(20) NOT NULL,
  qty_delta DECIMAL(18,4) NOT NULL,
  disposition_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id) REFERENCES receipts(id)
);

CREATE TABLE IF NOT EXISTS inventory_locations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  site_id BIGINT NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  capacity_qty DECIMAL(18,4) NOT NULL,
  occupied_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  current_sku VARCHAR(80) NULL,
  current_lot VARCHAR(80) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  KEY idx_inventory_site_active (site_id, is_active)
);

SET @has_inventory_site_id = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'inventory_locations'
    AND column_name = 'site_id'
);
SET @inventory_site_col_sql = IF(
  @has_inventory_site_id = 0,
  'ALTER TABLE inventory_locations ADD COLUMN site_id BIGINT NOT NULL DEFAULT 1 AFTER id',
  'SELECT 1'
);
PREPARE inventory_site_col_stmt FROM @inventory_site_col_sql;
EXECUTE inventory_site_col_stmt;
DEALLOCATE PREPARE inventory_site_col_stmt;

SET @has_inventory_site_idx = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'inventory_locations'
    AND index_name = 'idx_inventory_site_active'
);
SET @inventory_site_idx_sql = IF(
  @has_inventory_site_idx = 0,
  'CREATE INDEX idx_inventory_site_active ON inventory_locations (site_id, is_active)',
  'SELECT 1'
);
PREPARE inventory_site_idx_stmt FROM @inventory_site_idx_sql;
EXECUTE inventory_site_idx_stmt;
DEALLOCATE PREPARE inventory_site_idx_stmt;

CREATE TABLE IF NOT EXISTS production_plans (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  site_id BIGINT NOT NULL,
  plan_name VARCHAR(120) NOT NULL,
  start_week DATE NOT NULL,
  status VARCHAR(20) NOT NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plan_site_week (site_id, start_week)
);

CREATE TABLE IF NOT EXISTS production_plan_lines (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  plan_id BIGINT NOT NULL,
  week_index INT NOT NULL,
  item_code VARCHAR(80) NOT NULL,
  planned_qty DECIMAL(18,4) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_plan_week_item (plan_id, week_index, item_code),
  FOREIGN KEY (plan_id) REFERENCES production_plans(id)
);

CREATE TABLE IF NOT EXISTS bill_of_materials (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  parent_item_code VARCHAR(80) NOT NULL,
  component_code VARCHAR(80) NOT NULL,
  qty_per DECIMAL(18,4) NOT NULL
);

CREATE TABLE IF NOT EXISTS work_orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  plan_id BIGINT NOT NULL,
  item_code VARCHAR(80) NOT NULL,
  qty_target DECIMAL(18,4) NOT NULL,
  status VARCHAR(30) NOT NULL,
  scheduled_start DATETIME NULL,
  scheduled_end DATETIME NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES production_plans(id)
);

CREATE TABLE IF NOT EXISTS work_order_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  work_order_id BIGINT NOT NULL,
  event_type VARCHAR(20) NOT NULL,
  qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  reason_code VARCHAR(80) NULL,
  notes TEXT NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id)
);

CREATE TABLE IF NOT EXISTS plan_adjustments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  plan_id BIGINT NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  requested_by BIGINT NOT NULL,
  approved_by BIGINT NULL,
  status VARCHAR(20) NOT NULL,
  before_snapshot JSON NOT NULL,
  after_snapshot JSON NOT NULL,
  approved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES production_plans(id)
);

CREATE TABLE IF NOT EXISTS candidates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  full_name VARCHAR(200) NOT NULL,
  email VARCHAR(200) NULL,
  phone VARCHAR(40) NULL,
  dob_enc TEXT NOT NULL,
  ssn_last4_enc TEXT NOT NULL,
  source VARCHAR(80) NULL,
  duplicate_flag TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS interviewer_candidate_assignments (
  interviewer_user_id BIGINT NOT NULL,
  candidate_id BIGINT NOT NULL,
  PRIMARY KEY (interviewer_user_id, candidate_id),
  FOREIGN KEY (interviewer_user_id) REFERENCES users(id),
  FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

CREATE TABLE IF NOT EXISTS candidate_form_answers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  candidate_id BIGINT NOT NULL,
  field_key VARCHAR(120) NOT NULL,
  field_value JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

CREATE TABLE IF NOT EXISTS application_form_fields (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  field_key VARCHAR(120) NOT NULL UNIQUE,
  label VARCHAR(200) NOT NULL,
  field_type VARCHAR(40) NOT NULL,
  is_required TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS candidate_attachments (
  id VARCHAR(36) PRIMARY KEY,
  candidate_id BIGINT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL,
  classification VARCHAR(80) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

CREATE TABLE IF NOT EXISTS application_attachment_requirements (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  classification VARCHAR(80) NOT NULL UNIQUE,
  is_required TINYINT(1) NOT NULL DEFAULT 1,
  applies_to_source VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  topic VARCHAR(80) NOT NULL UNIQUE,
  title_template VARCHAR(200) NOT NULL,
  body_template TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  topic VARCHAR(80) NOT NULL,
  frequency VARCHAR(20) NOT NULL,
  dnd_start CHAR(5) NOT NULL DEFAULT '21:00',
  dnd_end CHAR(5) NOT NULL DEFAULT '07:00',
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_user_topic (user_id, topic),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL,
  deliver_after DATETIME NULL,
  delivered_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS message_queue (
  id VARCHAR(36) PRIMARY KEY,
  channel VARCHAR(40) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  export_file VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS search_documents (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  tags VARCHAR(500) NULL,
  source VARCHAR(80) NULL,
  topic VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_search_entity (entity_type, entity_id),
  INDEX idx_search_meta (entity_type, source, topic, created_at)
);

SET @has_search_fulltext = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'search_documents'
    AND index_name = 'ft_search_documents_text'
);
SET @search_fulltext_sql = IF(
  @has_search_fulltext = 0,
  'ALTER TABLE search_documents ADD FULLTEXT INDEX ft_search_documents_text (title, body, tags)',
  'SELECT 1'
);
PREPARE search_fulltext_stmt FROM @search_fulltext_sql;
EXECUTE search_fulltext_stmt;
DEALLOCATE PREPARE search_fulltext_stmt;

CREATE TABLE IF NOT EXISTS scoring_rule_versions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  version_name VARCHAR(120) NOT NULL,
  weights_json JSON NOT NULL,
  retake_policy VARCHAR(40) NOT NULL,
  effective_date DATE NOT NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS qualification_scores (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  candidate_id BIGINT NOT NULL,
  rule_version_id BIGINT NOT NULL,
  coursework_score DECIMAL(8,3) NOT NULL,
  midterm_score DECIMAL(8,3) NOT NULL,
  final_score DECIMAL(8,3) NOT NULL,
  weighted_score DECIMAL(8,3) NOT NULL,
  gpa DECIMAL(4,2) NOT NULL,
  credit_hours DECIMAL(8,3) NOT NULL,
  quality_points DECIMAL(8,3) NOT NULL,
  recalculation_pending TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id),
  FOREIGN KEY (rule_version_id) REFERENCES scoring_rule_versions(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_user_id BIGINT NULL,
  action VARCHAR(40) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(120) NOT NULL,
  before_value JSON NULL,
  after_value JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DELIMITER $$
DROP TRIGGER IF EXISTS trg_audit_logs_no_update $$
CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is immutable';
END $$

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete $$
CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is immutable';
END $$
DELIMITER ;
