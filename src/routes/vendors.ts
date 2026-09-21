import { Router } from 'express';
import { z } from 'zod';
import { listVendors, updateVendorDefaultBusinessRatio } from '../repositories/vendorRepo.js';
import { recordAuditLog } from '../repositories/auditRepo.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isUuid } from '../lib/isUuid.js';

export function vendorsRouter(): Router {
  const router = Router();

  router.param('id', (req, res, next, id) => {
    if (!isUuid(id)) {
      return res.status(400).json({ success: false, error: '不正なIDです。' });
    }
    next();
  });

  router.get('/', asyncHandler(async (_req, res) => {
    const vendors = await listVendors();
    res.json({ success: true, data: vendors });
  }));

  // 按分ルール設定画面: 取引先ごとのデフォルト事業按分比率を登録する
  router.patch('/:id/default-business-ratio', asyncHandler(async (req, res) => {
    const schema = z.object({
      ratio: z.number().min(0).max(1).nullable(),
      changedBy: z.string().min(1),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です（0〜1の比率を指定してください）。' });
    }
    const { ratio, changedBy } = parseResult.data;

    await updateVendorDefaultBusinessRatio(req.params.id, ratio);
    await recordAuditLog({
      invoiceId: null,
      action: 'update_vendor_business_ratio',
      fieldName: 'default_business_ratio',
      newValue: { vendorId: req.params.id, ratio },
      changedBy,
      reason: '按分ルール設定画面での更新',
    });

    res.json({ success: true });
  }));

  return router;
}
