import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ingestInvoice } from '../pipeline/ingestInvoice.js';
import { findInvoiceById, updateInvoiceFields } from '../repositories/invoiceRepo.js';
import { recordAuditLog } from '../repositories/auditRepo.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export function invoicesRouter(uploadDir: string): Router {
  const router = Router();

  // 画像・PDFのアップロード取込（レシート・請求書・通帳スキャン等）
  router.post('/upload', upload.single('file'), async (req, res) => {
    try {
      const direction = req.body.direction === 'income' ? 'income' : 'expense';
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'ファイルが添付されていません。' });
      }
      const result = await ingestInvoice(
        {
          kind: 'file',
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          originalFilename: req.file.originalname,
          direction,
        },
        uploadDir
      );
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('invoice upload error', err);
      res.status(500).json({ success: false, error: '取込処理中にエラーが発生しました。', details: err?.message });
    }
  });

  // メール本文などテキストのみの入力（明細なし・金額のみ）
  router.post('/from-text', async (req, res) => {
    const schema = z.object({
      text: z.string().min(1),
      direction: z.enum(['income', 'expense']).default('expense'),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。', details: parseResult.error.flatten() });
    }
    try {
      const result = await ingestInvoice({ kind: 'email_text', ...parseResult.data }, uploadDir);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('invoice text ingest error', err);
      res.status(500).json({ success: false, error: '取込処理中にエラーが発生しました。', details: err?.message });
    }
  });

  router.get('/:id', async (req, res) => {
    const invoice = await findInvoiceById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, error: '見つかりません。' });
    res.json({ success: true, data: invoice });
  });

  // 手動修正（金額・科目の訂正等）。必ず監査ログに変更前後の値を残す。
  router.patch('/:id', async (req, res) => {
    const schema = z.object({
      changedBy: z.string().min(1),
      reason: z.string().optional(),
      fields: z.record(z.any()),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。', details: parseResult.error.flatten() });
    }
    const { changedBy, reason, fields } = parseResult.data;

    const before = await findInvoiceById(req.params.id);
    if (!before) return res.status(404).json({ success: false, error: '見つかりません。' });

    await updateInvoiceFields(req.params.id, fields);
    await recordAuditLog({
      invoiceId: req.params.id,
      action: 'update',
      oldValue: before,
      newValue: fields,
      changedBy,
      reason: reason ?? null,
    });

    const after = await findInvoiceById(req.params.id);
    res.json({ success: true, data: after });
  });

  // 外貨建て証憑の為替レート・換算方法の指定
  router.patch('/:id/fx', async (req, res) => {
    const schema = z.object({
      fxRate: z.number().positive(),
      fxRateDate: z.string(), // YYYY-MM-DD（レート取得日を明記する）
      fxMethod: z.enum(['ttm', 'tts', 'ttb']),
      changedBy: z.string().min(1),
    });
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ success: false, error: '入力内容が不正です。', details: parseResult.error.flatten() });
    }
    const { fxRate, fxRateDate, fxMethod, changedBy } = parseResult.data;

    const before = await findInvoiceById(req.params.id);
    if (!before) return res.status(404).json({ success: false, error: '見つかりません。' });

    await updateInvoiceFields(req.params.id, { fxRate, fxRateDate, fxMethod });
    await recordAuditLog({
      invoiceId: req.params.id,
      action: 'update',
      fieldName: 'fx',
      oldValue: { fxRate: before.fx_rate, fxRateDate: before.fx_rate_date, fxMethod: before.fx_method },
      newValue: { fxRate, fxRateDate, fxMethod },
      changedBy,
      reason: '外貨換算レートの指定',
    });

    res.json({ success: true });
  });

  return router;
}
