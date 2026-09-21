import { Router } from 'express';
import { z } from 'zod';
import { decideApproval, listPendingApprovals } from '../repositories/approvalRepo.js';
import { findInvoiceById, updateInvoiceStatus } from '../repositories/invoiceRepo.js';
import { recordAuditLog } from '../repositories/auditRepo.js';
import { recordVendorCategoryMatch } from '../repositories/vendorRepo.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isUuid } from '../lib/isUuid.js';

export function approvalsRouter(): Router {
  const router = Router();

  router.param('id', (req, res, next, id) => {
    if (!isUuid(id)) {
      return res.status(400).json({ success: false, error: '不正なIDです。' });
    }
    next();
  });

  router.get('/', asyncHandler(async (_req, res) => {
    const rows = await listPendingApprovals();
    res.json({ success: true, data: rows });
  }));

  // 承認 / 差し戻し / 修正。差し戻し理由は audit_log に蓄積し、将来の自動化判断の学習データにする。
  router.post('/:id/decide', asyncHandler(async (req, res) => {
    const schema = z.object({
      decision: z.enum(['approved', 'rejected', 'needs_info']),
      approver: z.string().min(1),
      notes: z.string().optional(),
      // 承認時に科目を修正して確定させたい場合
      finalCategory: z.string().optional(),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。', details: parseResult.error.flatten() });
    }
    const { decision, approver, notes, finalCategory } = parseResult.data;

    const result = await decideApproval({ approvalId: req.params.id, decision, approver, notes });
    if (!result) return res.status(404).json({ success: false, error: '承認キューにレコードが見つかりません。' });

    const invoice = await findInvoiceById(result.invoiceId);
    if (!invoice) return res.status(404).json({ success: false, error: '対象の証憑が見つかりません。' });

    if (decision === 'approved') {
      const category = finalCategory ?? invoice.category;
      await updateInvoiceStatus(result.invoiceId, 'approved', category);
      if (invoice.vendor_id && category) {
        // 承認された取引先×科目の組み合わせを学習データとして積み増す（次回以降の自動提案の信頼度に反映）
        await recordVendorCategoryMatch(invoice.vendor_id, category);
      }
      await recordAuditLog({
        invoiceId: result.invoiceId,
        action: 'approve',
        oldValue: { category: invoice.category, status: invoice.status },
        newValue: { category, status: 'approved' },
        changedBy: approver,
        reason: notes ?? null,
      });
    } else if (decision === 'rejected') {
      await updateInvoiceStatus(result.invoiceId, 'rejected');
      await recordAuditLog({
        invoiceId: result.invoiceId,
        action: 'reject',
        oldValue: { status: invoice.status },
        newValue: { status: 'rejected' },
        changedBy: approver,
        reason: notes ?? '(理由未入力)',
      });
    } else {
      await recordAuditLog({
        invoiceId: result.invoiceId,
        action: 'needs_info',
        changedBy: approver,
        reason: notes ?? null,
      });
    }

    res.json({ success: true });
  }));

  return router;
}
