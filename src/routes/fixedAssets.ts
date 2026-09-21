import { Router } from 'express';
import { z } from 'zod';
import { createFixedAsset, deleteFixedAsset, listFixedAssets, updateFixedAsset } from '../repositories/fixedAssetRepo.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { isUuid } from '../lib/isUuid.js';

export function fixedAssetsRouter(): Router {
  const router = Router();

  router.param('id', (req, res, next, id) => {
    if (!isUuid(id)) {
      return res.status(400).json({ success: false, error: '不正なIDです。' });
    }
    next();
  });

  router.get('/', asyncHandler(async (_req, res) => {
    const assets = await listFixedAssets();
    res.json({ success: true, data: assets });
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().min(1),
      acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      acquisitionCost: z.number().nonnegative(),
      usefulLife: z.number().int().min(2).max(20),
      method: z.enum(['straight', 'declining']),
      businessRatio: z.number().min(0).max(1).default(1),
      priorAccumulatedDepreciation: z.number().nonnegative().default(0),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。', details: parseResult.error.flatten() });
    }
    const asset = await createFixedAsset(parseResult.data);
    res.json({ success: true, data: asset });
  }));

  router.patch('/:id', asyncHandler(async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).optional(),
      acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      acquisitionCost: z.number().nonnegative().optional(),
      usefulLife: z.number().int().min(2).max(20).optional(),
      method: z.enum(['straight', 'declining']).optional(),
      businessRatio: z.number().min(0).max(1).optional(),
      priorAccumulatedDepreciation: z.number().nonnegative().optional(),
      disposedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。', details: parseResult.error.flatten() });
    }
    await updateFixedAsset(req.params.id, parseResult.data);
    res.json({ success: true });
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    await deleteFixedAsset(req.params.id);
    res.json({ success: true });
  }));

  return router;
}
