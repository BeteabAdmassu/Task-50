import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { pool, withTx } from "../db.js";
import { config } from "../config.js";
import { decryptString, encryptString, maskSensitive } from "../utils/crypto.js";
import { AppError, assert } from "../utils/errors.js";
import { writeAudit } from "./audit-service.js";

const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const maxBytes = 20 * 1024 * 1024;
const candidateUploadTokenTtlSeconds = 60 * 60 * 24;

async function getRequiredAttachmentClasses(source, conn = null) {
  const queryable = conn || pool;
  const [rows] = await queryable.execute(
    `SELECT classification
     FROM application_attachment_requirements
     WHERE is_required = 1
       AND (applies_to_source IS NULL OR applies_to_source = ?)
     ORDER BY classification ASC`,
    [source || "PORTAL"]
  );
  return rows.map((row) => row.classification);
}

async function evaluateAttachmentCompleteness(candidateId, source, conn = null) {
  const queryable = conn || pool;
  const requiredClasses = await getRequiredAttachmentClasses(source, queryable);
  const [rows] = await queryable.execute(
    `SELECT classification, COUNT(*) AS count
     FROM candidate_attachments
     WHERE candidate_id = ?
     GROUP BY classification`,
    [candidateId]
  );
  const found = new Set(rows.filter((row) => Number(row.count) > 0).map((row) => row.classification));
  const missingRequiredClasses = requiredClasses.filter((item) => !found.has(item));
  return {
    requiredClasses,
    missingRequiredClasses,
    complete: missingRequiredClasses.length === 0
  };
}

export async function createCandidateApplication(input, actor) {
  assert(input.fullName, 400, "Full name is required");
  assert(input.dob, 400, "DOB is required");
  assert(input.ssnLast4 && String(input.ssnLast4).length === 4, 400, "SSN last4 is required");

  const missingRequired = await checkFormCompleteness(input.formData || []);
  assert(!missingRequired.length, 400, "Application is incomplete", { missingRequired });

  const duplicate = await detectDuplicate(input.fullName, input.dob, input.ssnLast4);
  return withTx(async (conn) => {
    const [result] = await conn.execute(
      `INSERT INTO candidates
        (full_name, email, phone, dob_enc, ssn_last4_enc, source, duplicate_flag)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.fullName,
        input.email || null,
        input.phone || null,
        encryptString(input.dob),
        encryptString(input.ssnLast4),
        input.source || "PORTAL",
        duplicate ? 1 : 0
      ]
    );
    const appId = result.insertId;

    if (Array.isArray(input.formData)) {
      for (const item of input.formData) {
        await conn.execute(
          `INSERT INTO candidate_form_answers
            (candidate_id, field_key, field_value)
           VALUES (?, ?, ?)`,
          [appId, item.fieldKey, JSON.stringify(item.fieldValue)]
        );
      }
    }

    await writeAudit({
      actorUserId: actor?.id || null,
      action: "CREATE",
      entityType: "candidate",
      entityId: appId,
      beforeValue: null,
      afterValue: {
        fullName: input.fullName,
        duplicateFlag: duplicate
      },
      conn
    });

    const attachmentCompleteness = await evaluateAttachmentCompleteness(
      appId,
      input.source || "PORTAL",
      conn
    );
    await writeAudit({
      actorUserId: actor?.id || null,
      action: "UPDATE",
      entityType: "candidate",
      entityId: appId,
      beforeValue: { attachmentCompleteness: null },
      afterValue: { attachmentCompleteness },
      conn
    });

    return {
      id: appId,
      duplicateFlag: duplicate,
      uploadToken: issueCandidateUploadToken(appId),
      attachmentCompleteness
    };
  });
}

export function issueCandidateUploadToken(candidateId) {
  return jwt.sign(
    {
      purpose: "CANDIDATE_ATTACHMENT",
      candidateId: String(candidateId)
    },
    config.jwtSecret,
    { expiresIn: candidateUploadTokenTtlSeconds }
  );
}

export function verifyCandidateUploadToken(token, candidateId) {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return (
      payload.purpose === "CANDIDATE_ATTACHMENT" &&
      String(payload.candidateId) === String(candidateId)
    );
  } catch {
    return false;
  }
}

export async function canActorAttachToCandidate(candidateId, actor) {
  if (!actor) return false;
  if (["ADMIN", "HR"].includes(actor.role)) return true;
  if (actor.role === "INTERVIEWER") {
    const [rows] = await pool.execute(
      `SELECT 1
       FROM interviewer_candidate_assignments
       WHERE interviewer_user_id = ? AND candidate_id = ?
       LIMIT 1`,
      [actor.id, candidateId]
    );
    return rows.length > 0;
  }
  return false;
}

async function checkFormCompleteness(formData) {
  const [requiredFields] = await pool.execute(
    `SELECT field_key
     FROM application_form_fields
     WHERE is_required = 1`
  );
  const provided = new Set(formData.map((item) => item.fieldKey));
  return requiredFields.map((row) => row.field_key).filter((key) => !provided.has(key));
}

export async function detectDuplicate(fullName, dob, ssnLast4) {
  const [rows] = await pool.execute(
    `SELECT id, dob_enc, ssn_last4_enc
     FROM candidates WHERE full_name = ?`,
    [fullName]
  );
  return rows.some((row) => decryptString(row.dob_enc) === dob && decryptString(row.ssn_last4_enc) === ssnLast4);
}

function classifyAttachment(fileName) {
  const name = fileName.toLowerCase();
  if (name.includes("resume")) return "RESUME";
  if (name.includes("id") || name.includes("license")) return "IDENTITY_DOC";
  if (name.includes("cert")) return "CERTIFICATION";
  return "OTHER";
}

export async function attachCandidateFile(candidateId, file, actor) {
  const mimeType = file?.type || file?.mimetype || file?.mime || null;
  const sourcePath = file?.path || file?.filepath || null;
  const originalName = file?.name || file?.originalFilename || "upload.bin";
  assert(file, 400, "File required");
  assert(allowedMimeTypes.has(mimeType), 400, "Only PDF/JPG/PNG allowed");
  assert(file.size <= maxBytes, 400, "File exceeds 20 MB");
  assert(sourcePath, 400, "Upload source path missing");

  const [candidates] = await pool.execute("SELECT id, source FROM candidates WHERE id = ?", [candidateId]);
  assert(candidates.length, 404, "Candidate not found");
  const candidate = candidates[0];

  await fs.mkdir(config.uploadDir, { recursive: true });
  const ext = path.extname(originalName || "").toLowerCase();
  const attachmentId = uuidv4();
  const destPath = path.join(config.uploadDir, `${attachmentId}${ext}`);
  await fs.copyFile(sourcePath, destPath);

  await pool.execute(
    `INSERT INTO candidate_attachments
      (id, candidate_id, original_name, stored_path, mime_type, size_bytes, classification)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      attachmentId,
      candidateId,
      originalName,
      destPath,
      mimeType,
      file.size,
      classifyAttachment(originalName)
    ]
  );

  await writeAudit({
    actorUserId: actor?.id || null,
    action: "CREATE",
    entityType: "candidate_attachment",
    entityId: attachmentId,
    beforeValue: null,
    afterValue: {
      candidateId,
      originalName
    }
  });

  const attachmentCompleteness = await evaluateAttachmentCompleteness(
    candidateId,
    candidate.source || "PORTAL"
  );
  await writeAudit({
    actorUserId: actor?.id || null,
    action: "UPDATE",
    entityType: "candidate",
    entityId: candidateId,
    beforeValue: null,
    afterValue: { attachmentCompleteness }
  });

  return { id: attachmentId, attachmentCompleteness };
}

export async function getCandidate(candidateId, actor) {
  const [rows] = await pool.execute(
    `SELECT id, full_name, email, phone, dob_enc, ssn_last4_enc, duplicate_flag, source, created_at
     FROM candidates WHERE id = ?`,
    [candidateId]
  );
  assert(rows.length, 404, "Candidate not found");
  const row = rows[0];
  const attachmentCompleteness = await evaluateAttachmentCompleteness(
    row.id,
    row.source || "PORTAL"
  );
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    dob: maskSensitive(decryptString(row.dob_enc), actor?.sensitiveDataView),
    ssnLast4: maskSensitive(decryptString(row.ssn_last4_enc), actor?.sensitiveDataView),
    duplicateFlag: Boolean(row.duplicate_flag),
    attachmentCompleteness,
    createdAt: row.created_at
  };
}
