import { Router } from 'express';
import { listApprovedInvoicesInRange } from '../repositories/invoiceRepo.js';
import { computeByCounterparty, computeMonthly, computeProfitLoss, type LedgerSourceInvoice } from '../accounting/journal.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export function reportsRouter(): Router {
  const router = Router();

  router.get('/profit-loss', asyncHandler(async (req, res) => {
    const { from, to } = requireRange(req.query);
    if (!from || !to) return res.status(400).json({ success: false, error: 'from, to (YYYY-MM-DD) が必要です。' });

    const rows = await listApprovedInvoicesInRange(from, to);
    const sourceInvoices = rows.map(toLedgerSource);
    res.json({
      success: true,
      data: {
        profitLoss: computeProfitLoss(sourceInvoices),
        monthly: computeMonthly(sourceInvoices),
      },
    });
  }));

  router.get('/by-counterparty', asyncHandler(async (req, res) => {
    const { from, to } = requireRange(req.query);
    const direction = req.query.direction === 'income' ? 'income' : 'expense';
    if (!from || !to) return res.status(400).json({ success: false, error: 'from, to (YYYY-MM-DD) が必要です。' });

    const rows = await listApprovedInvoicesInRange(from, to);
    const sourceInvoices = rows.map(toLedgerSource);
    res.json({ success: true, data: computeByCounterparty(sourceInvoices, direction) });
  }));

  return router;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireRange(query: Record<string, unknown>): { from: string | null; to: string | null } {
  const from = typeof query.from === 'string' && DATE_PATTERN.test(query.from) ? query.from : null;
  const to = typeof query.to === 'string' && DATE_PATTERN.test(query.to) ? query.to : null;
  return { from, to };
}

function toLedgerSource(row: any): LedgerSourceInvoice {
  return {
    id: row.id,
    direction: row.direction,
    issueDate: row.issue_date,
    category: row.category,
    amountInclTax: Number(row.amount_incl_tax) || 0,
    vendorName: row.vendor_name,
    paymentMethod: row.payment_method,
    description: row.description,
    businessRatio: row.business_ratio === null ? null : Number(row.business_ratio),
  };
}
