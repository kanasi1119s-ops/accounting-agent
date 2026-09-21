import { pool } from '../db/pool.js';

export interface NewInvoiceRecord {
  vendorId: string | null;
  vendorNameRaw: string | null;
  direction: 'income' | 'expense';
  documentType: 'receipt' | 'invoice' | 'statement' | 'email' | 'other';

  issueDate: string | null;
  amountExclTax: number | null;
  taxAmount: number | null;
  amountInclTax: number | null;
  taxRate: number | null;

  currency: string;
  fxRate: number | null;
  fxRateDate: string | null;
  fxMethod: 'ttm' | 'tts' | 'ttb' | null;

  invoiceRegistrationNumber: string | null;
  invoiceNumberValid: boolean | null;
  vendorRegistrationStatusAtTxn: 'registered' | 'unregistered' | 'unknown' | null;
  deemedDeductionRate: number | null;

  items: unknown[];

  sourceFilePath: string | null;
  sourceFileHash: string | null;
  dedupHash: string | null;
  duplicateOfInvoiceId: string | null;

  extractionMethod: 'pdf_text' | 'ocr_image' | 'manual' | 'unextractable';
  ocrRawJson: unknown | null;
  ocrConfidence: number | null;

  taxConsistencyStatus: 'ok' | 'mismatch' | 'unverified';

  category: string | null;
  categoryConfidence: number | null;
  categorySource: 'vendor_history' | 'keyword_guess' | 'rule' | 'manual' | null;
  allocationRequired: boolean;
  businessRatio: number | null;

  multiPageTotalMismatch: boolean;
  pageCount: number | null;

  description: string | null;
  paymentMethod: string | null;

  status:
    | 'pending_extraction'
    | 'pending_review'
    | 'needs_manual_input'
    | 'approved'
    | 'rejected'
    | 'duplicate_flagged';
}

export async function insertInvoice(rec: NewInvoiceRecord): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO invoices (
      vendor_id, vendor_name_raw, direction, document_type,
      issue_date, amount_excl_tax, tax_amount, amount_incl_tax, tax_rate,
      currency, fx_rate, fx_rate_date, fx_method,
      invoice_registration_number, invoice_number_valid, vendor_registration_status_at_txn, deemed_deduction_rate,
      items,
      source_file_path, source_file_hash, dedup_hash, duplicate_of_invoice_id,
      extraction_method, ocr_raw_json, ocr_confidence,
      tax_consistency_status,
      category, category_confidence, category_source, allocation_required, business_ratio,
      multi_page_total_mismatch, page_count,
      description, payment_method,
      status
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9,
      $10, $11, $12, $13,
      $14, $15, $16, $17,
      $18::jsonb,
      $19, $20, $21, $22,
      $23, $24::jsonb, $25,
      $26,
      $27, $28, $29, $30, $31,
      $32, $33,
      $34, $35,
      $36
    ) RETURNING id`,
    [
      rec.vendorId, rec.vendorNameRaw, rec.direction, rec.documentType,
      rec.issueDate, rec.amountExclTax, rec.taxAmount, rec.amountInclTax, rec.taxRate,
      rec.currency, rec.fxRate, rec.fxRateDate, rec.fxMethod,
      rec.invoiceRegistrationNumber, rec.invoiceNumberValid, rec.vendorRegistrationStatusAtTxn, rec.deemedDeductionRate,
      JSON.stringify(rec.items ?? []),
      rec.sourceFilePath, rec.sourceFileHash, rec.dedupHash, rec.duplicateOfInvoiceId,
      rec.extractionMethod, rec.ocrRawJson ? JSON.stringify(rec.ocrRawJson) : null, rec.ocrConfidence,
      rec.taxConsistencyStatus,
      rec.category, rec.categoryConfidence, rec.categorySource, rec.allocationRequired, rec.businessRatio,
      rec.multiPageTotalMismatch, rec.pageCount,
      rec.description, rec.paymentMethod,
      rec.status,
    ]
  );
  return rows[0].id;
}

export async function findInvoiceById(id: string): Promise<any | null> {
  const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
  return rows[0] ?? null;
}

/** 重複請求書検知: 同一のdedup_hashを持つ既存invoiceを探す */
export async function findByDedupHash(hash: string): Promise<{ id: string } | null> {
  const { rows } = await pool.query(
    `SELECT id FROM invoices WHERE dedup_hash = $1 AND status <> 'rejected' LIMIT 1`,
    [hash]
  );
  return rows[0] ?? null;
}

export async function listInvoicesByStatus(status: string): Promise<any[]> {
  const { rows } = await pool.query('SELECT * FROM invoices WHERE status = $1 ORDER BY created_at DESC', [status]);
  return rows;
}

export async function listApprovedInvoicesInRange(fromDate: string, toDate: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT i.*, v.name AS vendor_name FROM invoices i
     LEFT JOIN vendors v ON v.id = i.vendor_id
     WHERE i.status = 'approved' AND i.issue_date BETWEEN $1 AND $2
     ORDER BY i.issue_date ASC`,
    [fromDate, toDate]
  );
  return rows;
}

export async function updateInvoiceFields(id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${toSnakeCase(k)} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE invoices SET ${setClauses}, updated_at = now() WHERE id = $1`, [
    id,
    ...keys.map((k) => fields[k]),
  ]);
}

function toSnakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
