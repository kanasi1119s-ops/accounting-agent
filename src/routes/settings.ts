import { Router } from 'express';
import { z } from 'zod';
import { getAllSettings, updateSetting } from '../repositories/settingsRepo.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export function settingsRouter(): Router {
  const router = Router();

  router.get('/', asyncHandler(async (_req, res) => {
    const settings = await getAllSettings();
    res.json({ success: true, data: settings });
  }));

  // 信頼度閾値・金額閾値などを設定画面から調整する（コードに埋め込まず外出しの値として管理）
  router.patch('/:key', asyncHandler(async (req, res) => {
    const schema = z.object({ value: z.any() });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。' });
    }
    await updateSetting(req.params.key, parseResult.data.value);
    res.json({ success: true });
  }));

  return router;
}
