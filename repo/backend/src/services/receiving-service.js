import { pool, withTx } from "../db.js";
import { AppError, assert } from "../utils/errors.js";
import { writeAudit } from "./audit-service.js";
import { upsertSearchDocument } from "./search-index-service.js";
import { config } from "../config.js";
import fs from "node:fs/promises";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";

const allowedDiscrepancies = ["OVER", "SHORT", "DAMAGED"];
const allowedDocumentMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const maxDocumentBytes = 20 * 1024 * 1024;

export async function scheduleDockAppointment(input, actor) {
  assert(input.siteId, 400, "siteId required");
  assert(input.startAt, 400, "startAt required");
  assert(input.endAt, 400, "endAt required");

  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  assert((end - start) / (1000 * 60) === 30, 400, "Only 30-minute windows are allowed");
  assert(start.getMinutes() === 0 || start.getMinutes() === 30, 400, "Start must be at :00 or :30");

  if (actor.role === "CLERK" && actor.siteId !== input.siteId) {
    throw new AppError(403, "Clerks can schedule only for their site");
  }

  const [conflicts] = await pool.execute(
    `SELECT id
     FROM dock_appointments
     WHERE site_id = ?
       AND status <> 'CANCELLED'
       AND start_at < ?
       AND end_at > ?
     LIMIT 1`,
    [input.siteId, input.endAt, input.startAt]
  );
  assert(!conflicts.length, 409, "Time slot already booked");

  const [result] = await pool.execute(
    `INSERT INTO dock_appointments
      (site_id, po_number, start_at, end_at, status, notes, created_by)
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, ?)`,
    [input.siteId, input.poNumber || null, input.startAt, input.endAt, input.notes || null, actor.id]
  );

  await writeAudit({
    actorUserId: actor.id,
    action: "CREATE",
    entityType: "dock_appointment",
    entityId: result.insertId,
    beforeValue: null,
    afterValue: input
  });

  return { id: result.insertId };
}

export async function createReceipt(input, actor) {
  assert(input.poNumber, 400, "poNumber required");
  assert(Array.isArray(input.lines) && input.lines.length > 0, 400, "lines required");
  if (actor.role === "CLERK" && actor.siteId !== input.siteId) {
    throw new AppError(403, "Clerks can post only for their site");
  }

  return withTx(async (conn) => {
    const [header] = await conn.execute(
      `INSERT INTO receipts
        (site_id, po_number, status, received_by)
       VALUES (?, ?, 'OPEN', ?)`,
      [input.siteId, input.poNumber, actor.id]
    );

    for (const line of input.lines) {
      const qtyExpected = Number(line.qtyExpected);
      const qtyReceived = Number(line.qtyReceived);
      const qtyDelta = qtyReceived - qtyExpected;
      
      await conn.execute(
        `INSERT INTO receipt_lines
          (receipt_id, po_line_no, sku, lot_no, qty_expected, qty_received,
           inspection_status, storage_location_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          header.insertId,
          line.poLineNo,
          line.sku,
          line.lotNo || null,
          qtyExpected,
          qtyReceived,
          line.inspectionStatus || "PENDING",
          line.storageLocationId || null
        ]
      );

      if (qtyDelta !== 0 || line.discrepancyType) {
        const discrepancyType = line.discrepancyType || (
          qtyDelta > 0 ? "OVER" : qtyDelta < 0 ? "SHORT" : null
        );
        
        if (discrepancyType) {
          assert(
            allowedDiscrepancies.includes(discrepancyType),
            400,
            "Invalid discrepancy type"
          );
          assert(
            line.dispositionNote && line.dispositionNote.trim().length > 0,
            400,
            "Disposition note required for quantity discrepancies"
          );
          
          await conn.execute(
            `INSERT INTO receipt_discrepancies
              (receipt_id, po_line_no, discrepancy_type, qty_delta, disposition_note)
             VALUES (?, ?, ?, ?, ?)`,
            [
              header.insertId,
              line.poLineNo,
              discrepancyType,
              qtyDelta,
              line.dispositionNote || null
            ]
          );
        }
      }
    }

    await writeAudit({
      actorUserId: actor.id,
      action: "CREATE",
      entityType: "receipt",
      entityId: header.insertId,
      beforeValue: null,
      afterValue: input,
      conn
    });

    await upsertSearchDocument({
      entityType: "receipt",
      entityId: header.insertId,
      title: `Receipt ${header.insertId} for PO ${input.poNumber}`,
      body: `Inbound receipt at site ${input.siteId}`,
      tags: ["receipt", "inbound", input.poNumber],
      source: "RECEIVING",
      topic: "INBOUND"
    }, conn);

    return { id: header.insertId };
  });
}

export async function closeReceipt(receiptId, actor) {
  const [receipts] = await pool.execute(
    `SELECT id, site_id, status, received_by
     FROM receipts WHERE id = ?`,
    [receiptId]
  );
  assert(receipts.length, 404, "Receipt not found");
  const receipt = receipts[0];
  
  assert(receipt.status === "OPEN", 400, "Receipt is not open");

  if (actor.role === "CLERK") {
    assert(Number(actor.siteId) === Number(receipt.site_id), 403, "Clerks can only close receipts for their site");
  } else if (!["ADMIN", "PLANNER_SUPERVISOR"].includes(actor.role)) {
    throw new AppError(403, "Only site clerks, supervisors, or admins can close receipts");
  }
  
  const [unresolvedDiscrepancies] = await pool.execute(
    `SELECT id
     FROM receipt_discrepancies
     WHERE receipt_id = ?
       AND (disposition_note IS NULL OR disposition_note = '')`,
    [receiptId]
  );
  assert(!unresolvedDiscrepancies.length, 400, "All discrepancies must have disposition notes");
  
  const [quantityDiscrepancies] = await pool.execute(
    `SELECT rl.id, rl.po_line_no, rl.qty_expected, rl.qty_received,
            (rl.qty_received - rl.qty_expected) AS qty_delta,
            rd.id AS discrepancy_id,
            rd.discrepancy_type,
            rd.disposition_note
     FROM receipt_lines rl
     LEFT JOIN receipt_discrepancies rd ON rd.receipt_id = rl.receipt_id AND rd.po_line_no = rl.po_line_no
     WHERE rl.receipt_id = ?
       AND rl.qty_received != rl.qty_expected`,
    [receiptId]
  );

  const invalidDiscrepancies = quantityDiscrepancies.filter((d) => {
    if (!d.discrepancy_id) return true;
    if (!allowedDiscrepancies.includes(d.discrepancy_type)) return true;
    if (!d.disposition_note || String(d.disposition_note).trim() === "") return true;
    return false;
  });

  if (invalidDiscrepancies.length > 0) {
    throw new AppError(400, "Quantity discrepancies require valid type and disposition note", {
      lines: invalidDiscrepancies.map((d) => ({
        poLineNo: d.po_line_no,
        expected: d.qty_expected,
        received: d.qty_received,
        delta: d.qty_delta,
        discrepancyType: d.discrepancy_type || null
      }))
    });
  }

  await pool.execute("UPDATE receipts SET status = 'CLOSED', closed_at = NOW() WHERE id = ?", [
    receiptId
  ]);
  await writeAudit({
    actorUserId: actor.id,
    action: "APPROVE",
    entityType: "receipt",
    entityId: receiptId,
    beforeValue: { status: "OPEN", site_id: receipt.site_id },
    afterValue: { status: "CLOSED", site_id: receipt.site_id }
  });

  await upsertSearchDocument({
    entityType: "receipt",
    entityId: receiptId,
    title: `Receipt ${receiptId} CLOSED`,
    body: `Receipt closed for site ${receipt.site_id}`,
    tags: ["receipt", "closed"],
    source: "RECEIVING",
    topic: "INBOUND"
  });
}

export async function recommendPutaway({ siteId, sku, lotNo, quantity }, actor) {
  assert(siteId, 400, "siteId required");
  if (actor.role !== "ADMIN") {
    assert(Number(actor.siteId) === Number(siteId), 403, "Putaway recommendations are limited to your site");
  }

  const [bins] = await pool.execute(
    `SELECT id, code, capacity_qty, occupied_qty, current_sku, current_lot
     FROM inventory_locations
     WHERE site_id = ?
       AND is_active = 1
     ORDER BY occupied_qty ASC, code ASC`,
    [siteId]
  );

  for (const bin of bins) {
    const available = bin.capacity_qty - bin.occupied_qty;
    if (available < quantity) continue;
    const empty = !bin.current_sku;
    const sameSkuLot = bin.current_sku === sku && bin.current_lot === lotNo;
    if (empty || sameSkuLot) {
      return {
        locationId: bin.id,
        locationCode: bin.code,
        availableQty: available,
        mixedStorageAllowed: sameSkuLot
      };
    }
  }
  throw new AppError(409, "No valid location found for putaway");
}

async function getReceiptForActor(receiptId, actor) {
  const [rows] = await pool.execute(
    `SELECT id, site_id, po_number
     FROM receipts
     WHERE id = ?`,
    [receiptId]
  );
  assert(rows.length, 404, "Receipt not found");
  const receipt = rows[0];
  if (actor.role === "CLERK") {
    assert(Number(actor.siteId) === Number(receipt.site_id), 403, "Clerks can only manage documents for their site");
  }
  return receipt;
}

export async function uploadReceiptDocument(receiptId, payload, file, actor) {
  const mimeType = file?.type || file?.mimetype || file?.mime || null;
  const sourcePath = file?.path || file?.filepath || null;
  const originalName = file?.name || file?.originalFilename || "receipt-document.bin";
  assert(file, 400, "File required");
  assert(sourcePath, 400, "Upload source path missing");
  assert(allowedDocumentMimeTypes.has(mimeType), 400, "Only PDF/JPG/PNG allowed");
  assert(file.size <= maxDocumentBytes, 400, "File exceeds 20 MB");

  const receipt = await getReceiptForActor(receiptId, actor);

  await fs.mkdir(config.uploadDir, { recursive: true });
  const ext = path.extname(originalName).toLowerCase();
  const docId = uuidv4();
  const destPath = path.join(config.uploadDir, `${docId}${ext}`);
  await fs.copyFile(sourcePath, destPath);

  await pool.execute(
    `INSERT INTO receipt_documents
      (id, receipt_id, po_line_no, lot_no, storage_location_id, title,
       original_name, stored_path, mime_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      docId,
      receiptId,
      payload?.poLineNo || null,
      payload?.lotNo || null,
      payload?.storageLocationId || null,
      payload?.title || null,
      originalName,
      destPath,
      mimeType,
      file.size,
      actor.id
    ]
  );

  await writeAudit({
    actorUserId: actor.id,
    action: "CREATE",
    entityType: "receipt_document",
    entityId: docId,
    beforeValue: null,
    afterValue: {
      receiptId: Number(receiptId),
      poNumber: receipt.po_number,
      poLineNo: payload?.poLineNo || null,
      lotNo: payload?.lotNo || null,
      storageLocationId: payload?.storageLocationId || null,
      originalName
    }
  });

  await upsertSearchDocument({
    entityType: "receipt",
    entityId: receiptId,
    title: `Receipt ${receiptId} document uploaded`,
    body: `Document ${originalName} uploaded for PO ${receipt.po_number}`,
    tags: ["receipt", "document", payload?.poLineNo || "no-line", payload?.lotNo || "no-lot"],
    source: "RECEIVING",
    topic: "INBOUND"
  });

  return { id: docId };
}

export async function listReceiptDocuments(receiptId, actor) {
  await getReceiptForActor(receiptId, actor);
  const [rows] = await pool.execute(
    `SELECT id, receipt_id, po_line_no, lot_no, storage_location_id, title,
            original_name, mime_type, size_bytes, uploaded_by, created_at
     FROM receipt_documents
     WHERE receipt_id = ?
     ORDER BY created_at DESC`,
    [receiptId]
  );
  return rows;
}
