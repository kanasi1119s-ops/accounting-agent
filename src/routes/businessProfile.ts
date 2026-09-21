import { Router } from 'express';
import { z } from 'zod';
import { getBusinessProfile, saveBusinessProfile } from '../repositories/businessProfileRepo.js';
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

  // 事業者プロフィール全体を丸ごと保存する（フォームからの一括保存を想定）
  router.put('/:year', asyncHandler(async (req, res) => {
    const schema = z.object({}).passthrough();
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。' });
    }
    const year = Number(req.params.year);
    await saveBusinessProfile(year, { ...parseResult.data, fiscalYear: year } as any);
    res.json({ success: true });
  }));

  return router;
}
