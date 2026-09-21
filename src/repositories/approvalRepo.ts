import { pool } from '../db/pool.js';

export async function enqueueForApproval(invoiceId: string, reasons: string[]): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO approval_queue (invoice_id, reasons) VALUES ($1, $2) RETURNING id`,
    [invoiceId, reasons]
  );
  return rows[0].id;
}

// 'needs_info'（要確認にする）は「まだ決着していない」状態なので一覧に残す。
// ここで 'pending' だけに絞ると、要確認にした証憑が二度と承認キューに現れなくなる。
export async function listPendingApprovals(): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT q.*, i.vendor_name_raw, i.category, i.amount_incl_tax, i.direction, i.issue_date, i.status AS invoice_status
     FROM approval_queue q
     JOIN invoices i ON i.id = q.invoice_id
     WHERE q.status IN ('pending', 'needs_info')
     ORDER BY (q.status = 'needs_info') ASC, q.created_at ASC`
  );
  return rows;
}

export async function decideApproval(params: {
  approvalId: string;
  decision: 'approved' | 'rejected' | 'needs_info';
  approver: string;
  notes?: string;
}): Promise<{ invoiceId: string } | null> {
  const { rows } = await pool.query(
    `UPDATE approval_queue
     SET status = $2, approver = $3, decided_at = now(), decision_notes = $4, updated_at = now()
     WHERE id = $1
     RETURNING invoice_id`,
    [params.approvalId, params.decision, params.approver, params.notes ?? null]
  );
  if (rows.length === 0) return null;
  return { invoiceId: rows[0].invoice_id };
}
