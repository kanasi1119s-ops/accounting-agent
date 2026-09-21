import { Router } from 'express';
import { getBusinessProfile, saveBusinessProfile } from '../repositories/businessProfileRepo.js';
import { businessProfileSchema } from '../types/businessProfileSchema.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const YEAR_PATTERN = /^\d{4}$/;

export function businessProfileRouter(): Router {
  const router = Router();

  router.param('year', (req, res, next, year) => {
    if (!YEAR_PATTERN.test(year)) {
      return res.status(400).json({ success: false, error: '不正な年度です。' });
    }
    next();
  });

  router.get('/:year', asyncHandler(async (req, res) => {
    const profile = await getBusinessProfile(Number(req.params.year));
    res.json({ success: true, data: profile });
  }));

  // 事業者プロフィール全体を丸ごと保存する（フォームからの一括保存を想定）。
  // 型・enum値・数値範囲を厳格に検証する（不正な blueDeduction や consumptionTax.method が
  // そのまま保存されて税額計算を狂わせることがないように）。未指定のフィールドはスキーマ側の
  // デフォルト値で個別に補完されるため、部分的なペイロードでも既定値が消えることはない。
  router.put('/:year', asyncHandler(async (req, res) => {
    const year = Number(req.params.year);
    const parseResult = businessProfileSchema.safeParse({ ...req.body, fiscalYear: year });
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。', details: parseResult.error.flatten() });
    }
    await saveBusinessProfile(year, parseResult.data);
    res.json({ success: true });
  }));

  return router;
}
