import { pool } from '../db/pool.js';

export async function recordAuditLog(entry: {
  invoiceId: string | null;
  action: string;
  fieldName?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  changedBy: string;
  reason?: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (invoice_id, action, field_name, old_value, new_value, changed_by, reason)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [
      entry.invoiceId,
      entry.action,
      entry.fieldName ?? null,
      entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      entry.changedBy,
      entry.reason ?? null,
    ]
  );
}

/** 差し戻し理由の一覧（将来、傾向分析や自動化判断の学習データとして使う） */
export async function listRejectionReasons(limit = 200): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT invoice_id, reason, changed_by, created_at FROM audit_log
     WHERE action = 'reject' AND reason IS NOT NULL
     ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}
