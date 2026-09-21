/**
 * OCR取込 → 検証 → 仕訳提案 までの一連のパイプライン。
 *
 * 入力の種類ごとの処理分岐:
 * - PDF（テキスト埋め込み型）: pdfText.ts でテキスト直接抽出 → Geminiでテキストから構造化
 * - PDF（スキャン画像型）: Gemini Visionへ直接渡してOCR
 * - 画像（JPEG/PNG）: Gemini VisionでOCR
 * - メール本文（金額のみ・明細なし）: 抽出不可としてフラグを立て、手動入力を促す
 * - 複数ページPDF: ページ単位の小計を合計と突き合わせ、不一致なら警告フラグ
 *
 * フェーズ1方針により、抽出に成功しても必ず承認キューへ回す（自動仕訳はしない）。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkInvoiceRegistrationNumber, resolveDeemedDeductionRate, resolveVendorRegistrationStatus } from '../lib/invoiceNumber.js';
import { checkTaxConsistency } from '../lib/taxConsistency.js';
import { computeDedupHash } from '../lib/dedupHash.js';
import { suggestCategory } from '../accounting/categorySuggestion.js';
import { isAllocationProne } from '../accounting/accounts.js';
import { extractPdfText, checkMultiPageTotal } from '../ocr/pdfText.js';
import { runReceiptOcr, structureFromText, OcrUnavailableError, type Direction, type OcrResult } from '../ocr/gemini.js';
import { findByDedupHash, insertInvoice, type NewInvoiceRecord } from '../repositories/invoiceRepo.js';
import { enqueueForApproval } from '../repositories/approvalRepo.js';
import { findOrCreateVendorByName, getVendorCategoryHistory } from '../repositories/vendorRepo.js';
import { recordAuditLog } from '../repositories/auditRepo.js';
import { getSetting } from '../repositories/settingsRepo.js';

export type IngestInput =
  | { kind: 'file'; buffer: Buffer; mimeType: string; originalFilename: string; direction: Direction }
  | { kind: 'email_text'; text: string; direction: Direction };

export interface IngestResult {
  invoiceId: string;
  status: string;
  approvalReasons: string[];
  notes: string[];
}

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export async function ingestInvoice(input: IngestInput, uploadDir: string): Promise<IngestResult> {
  const notes: string[] = [];

  if (input.kind === 'email_text') {
    return ingestUnextractable(input.direction, input.text, notes);
  }

  const { buffer, mimeType, direction } = input;

  let extractionMethod: NewInvoiceRecord['extractionMethod'];
  let parsed: OcrResult | null = null;
  let ocrRaw: unknown = null;
  let pageCount: number | null = null;
  let multiPageCheck: { mismatch: boolean; notes: string[] } = { mismatch: false, notes: [] };

  try {
    if (mimeType === 'application/pdf') {
      const pdfInfo = await extractPdfText(buffer);
      pageCount = pdfInfo.pageCount;

      if (pdfInfo.isTextEmbedded) {
        extractionMethod = 'pdf_text';
        const { raw, parsed: p } = await structureFromText({ text: pdfInfo.fullText, direction });
        ocrRaw = raw;
        parsed = p;

        if (pageCount > 1) {
          const check = checkMultiPageTotal(pdfInfo.pageTexts, p.total);
          multiPageCheck = { mismatch: check.mismatch, notes: check.notes };
          notes.push(...check.notes);
        }
      } else {
        extractionMethod = 'ocr_image';
        const dataUrl = `data:application/pdf;base64,${buffer.toString('base64')}`;
        const { raw, parsed: p } = await runReceiptOcr({ imageBase64: dataUrl, mimeType, direction });
        ocrRaw = raw;
        parsed = p;
        if (pageCount > 1) {
          notes.push('スキャン画像PDF（複数ページ）は現状ページ単位の合計突き合わせに対応していません。目視確認してください。');
        }
      }
    } else if (IMAGE_MIME_TYPES.has(mimeType)) {
      extractionMethod = 'ocr_image';
      const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
      const { raw, parsed: p } = await runReceiptOcr({ imageBase64: dataUrl, mimeType, direction });
      ocrRaw = raw;
      parsed = p;
    } else {
      extractionMethod = 'unextractable';
      notes.push(`未対応のファイル形式です（${mimeType}）。手動で入力してください。`);
    }
  } catch (err) {
    if (err instanceof OcrUnavailableError) {
      extractionMethod = 'unextractable';
      notes.push(err.message);
    } else {
      throw err;
    }
  }

  const sourceFilePath = await saveUploadedFile(buffer, input.originalFilename, uploadDir);

  if (!parsed) {
    return finalizeUnextractable({
      direction,
      documentType: 'other',
      sourceFilePath,
      pageCount,
      notes,
    });
  }

  return finalizeExtracted({
    direction,
    parsed,
    ocrRaw,
    extractionMethod,
    sourceFilePath,
    sourceFileHash: hashBuffer(buffer),
    pageCount,
    multiPageMismatch: multiPageCheck.mismatch,
    notes,
  });
}

async function ingestUnextractable(direction: Direction, text: string, notes: string[]): Promise<IngestResult> {
  notes.push('メール本文からの金額のみの入力は自動抽出できません。明細を手動で入力してください。');
  return finalizeUnextractable({
    direction,
    documentType: 'email',
    sourceFilePath: null,
    pageCount: null,
    notes,
    rawEmailText: text,
  });
}

async function finalizeUnextractable(params: {
  direction: Direction;
  documentType: NewInvoiceRecord['documentType'];
  sourceFilePath: string | null;
  pageCount: number | null;
  notes: string[];
  rawEmailText?: string;
}): Promise<IngestResult> {
  const record: NewInvoiceRecord = {
    vendorId: null,
    vendorNameRaw: null,
    direction: params.direction,
    documentType: params.documentType,
    issueDate: null,
    amountExclTax: null,
    taxAmount: null,
    amountInclTax: null,
    taxRate: null,
    currency: 'JPY',
    fxRate: null,
    fxRateDate: null,
    fxMethod: null,
    invoiceRegistrationNumber: null,
    invoiceNumberValid: null,
    vendorRegistrationStatusAtTxn: null,
    deemedDeductionRate: null,
    items: [],
    sourceFilePath: params.sourceFilePath,
    sourceFileHash: null,
    dedupHash: null,
    duplicateOfInvoiceId: null,
    extractionMethod: 'unextractable',
    ocrRawJson: params.rawEmailText ? { emailText: params.rawEmailText } : null,
    ocrConfidence: null,
    taxConsistencyStatus: 'unverified',
    category: null,
    categoryConfidence: null,
    categorySource: null,
    allocationRequired: false,
    multiPageTotalMismatch: false,
    pageCount: params.pageCount,
    description: null,
    paymentMethod: null,
    status: 'needs_manual_input',
  };

  const invoiceId = await insertInvoice(record);
  const reasons = ['extraction_failed'];
  await enqueueForApproval(invoiceId, reasons);
  await recordAuditLog({
    invoiceId,
    action: 'create',
    changedBy: 'system',
    newValue: { status: record.status, notes: params.notes },
    reason: '自動抽出不可のため手動入力待ちで取込',
  });

  return { invoiceId, status: record.status, approvalReasons: reasons, notes: params.notes };
}

async function finalizeExtracted(params: {
  direction: Direction;
  parsed: OcrResult;
  ocrRaw: unknown;
  extractionMethod: NewInvoiceRecord['extractionMethod'];
  sourceFilePath: string | null;
  sourceFileHash: string;
  pageCount: number | null;
  multiPageMismatch: boolean;
  notes: string[];
}): Promise<IngestResult> {
  const { direction, parsed, notes } = params;

  // 1. 取引先解決（経費側は支払先、収益側は請求先。どちらも vendors マスタで一元管理する）
  const vendorName = parsed.merchant.trim();
  const vendor = vendorName ? await findOrCreateVendorByName(vendorName) : null;

  // 2. インボイス登録番号の形式チェック・登録状況・経過措置控除率
  const invoiceNumberCheck = checkInvoiceRegistrationNumber(parsed.invoiceNumber);
  const registrationStatus = resolveVendorRegistrationStatus({
    vendorMasterStatus: vendor?.registrationStatus,
    invoiceNumberOnDocument: parsed.invoiceNumber,
  });
  const deemedDeductionRate =
    direction === 'expense' ? resolveDeemedDeductionRate(registrationStatus, parsed.date) : null;

  if (direction === 'expense' && registrationStatus === 'unregistered') {
    notes.push(
      deemedDeductionRate !== null
        ? `適格請求書発行事業者への登録が確認できません。経過措置により仕入税額の ${Math.round(deemedDeductionRate * 100)}% のみ控除対象です。`
        : '適格請求書発行事業者への登録が確認できません。'
    );
  }

  // 3. 税抜×税率=税込 整合性チェック（不一致でも自動修正はしない）
  const taxCheck = checkTaxConsistency({
    amountExclTax: parsed.amount,
    taxAmount: parsed.tax,
    amountInclTax: parsed.total,
    taxRate: parsed.taxRate,
  });
  notes.push(...taxCheck.notes);

  // 4. 重複請求書検知（発行日+取引先+金額のハッシュ）
  const dedupHash = computeDedupHash({
    issueDate: parsed.date,
    vendorName: vendorName || null,
    amountInclTax: parsed.total,
  });
  const duplicate = dedupHash ? await findByDedupHash(dedupHash) : null;
  if (duplicate) {
    notes.push(`同一日付・取引先・金額の既存レコードが見つかりました（重複の可能性）: ${duplicate.id}`);
  }

  // 5. 仕訳ロジック: 取引先の紐付け履歴を優先し、なければキーワード推測にフォールバック
  const vendorHistory = vendor ? await getVendorCategoryHistory(vendor.id) : [];
  const itemText = [parsed.description, ...(parsed.items || []).map((i) => i.name)].filter(Boolean).join(' ');
  const suggestion = suggestCategory({ vendorHistory, itemText, direction });
  const category = suggestion.category ?? parsed.category;
  const categorySource = suggestion.source ?? (parsed.category ? 'rule' : null);
  const allocationRequired = direction === 'expense' && isAllocationProne(category);
  if (allocationRequired) {
    notes.push(`「${category}」は家事按分が必要になりやすい科目です。自動計算はせず、按分ルール設定画面での確認を推奨します。`);
  }

  // 6. 外貨判定
  const isForeignCurrency = parsed.currency !== 'JPY';
  if (isForeignCurrency) {
    notes.push(`外貨（${parsed.currency}）建ての証憑です。為替レートと換算方法（TTM/TTS/TTB）を承認画面で指定してください。`);
  }

  const confidenceThreshold = await getSetting<number>('category_confidence_threshold');
  const amountThreshold = await getSetting<number>('auto_approval_amount_threshold');

  const status: NewInvoiceRecord['status'] = duplicate ? 'duplicate_flagged' : 'pending_review';

  const record: NewInvoiceRecord = {
    vendorId: vendor?.id ?? null,
    vendorNameRaw: vendorName || null,
    direction,
    documentType: parsed.documentType,
    issueDate: parsed.date || null,
    amountExclTax: parsed.amount,
    taxAmount: parsed.tax,
    amountInclTax: parsed.total,
    taxRate: parsed.taxRate,
    currency: parsed.currency,
    fxRate: null,
    fxRateDate: null,
    fxMethod: null,
    invoiceRegistrationNumber: invoiceNumberCheck.normalized,
    invoiceNumberValid: invoiceNumberCheck.normalized ? invoiceNumberCheck.isValidFormat : null,
    vendorRegistrationStatusAtTxn: registrationStatus,
    deemedDeductionRate,
    items: parsed.items || [],
    sourceFilePath: params.sourceFilePath,
    sourceFileHash: params.sourceFileHash,
    dedupHash,
    duplicateOfInvoiceId: duplicate?.id ?? null,
    extractionMethod: params.extractionMethod,
    ocrRawJson: params.ocrRaw,
    ocrConfidence: parsed.confidence,
    taxConsistencyStatus: taxCheck.status,
    category,
    categoryConfidence: suggestion.confidence || null,
    categorySource,
    allocationRequired,
    multiPageTotalMismatch: params.multiPageMismatch,
    pageCount: params.pageCount,
    description: parsed.description || null,
    paymentMethod: parsed.paymentMethod || null,
    status,
  };

  const invoiceId = await insertInvoice(record);

  // 7. 承認キュー投入理由の算出（フェーズ1は常に全件保留だが、理由は将来の自動化判断のため記録する）
  const reasons: string[] = ['phase1_all_pending'];
  if (parsed.total >= amountThreshold) reasons.push('amount_threshold');
  if ((suggestion.confidence || 0) < confidenceThreshold) reasons.push('low_confidence');
  if (direction === 'expense' && invoiceNumberCheck.normalized && !invoiceNumberCheck.isValidFormat) {
    reasons.push('invoice_requirement');
  }
  if (params.multiPageMismatch) reasons.push('multi_page_mismatch');
  if (duplicate) reasons.push('duplicate');
  if (taxCheck.status === 'mismatch') reasons.push('tax_mismatch');
  if (isForeignCurrency) reasons.push('foreign_currency');
  if (allocationRequired) reasons.push('allocation_required');

  await enqueueForApproval(invoiceId, reasons);
  await recordAuditLog({
    invoiceId,
    action: 'create',
    changedBy: 'system',
    newValue: { status, category, categoryConfidence: suggestion.confidence, reasons },
    reason: 'OCR取込・自動検証・仕訳提案',
  });

  return { invoiceId, status, approvalReasons: reasons, notes };
}

async function saveUploadedFile(buffer: Buffer, originalFilename: string, uploadDir: string): Promise<string> {
  await fs.mkdir(uploadDir, { recursive: true });
  const ext = path.extname(originalFilename) || '.bin';
  const filename = `${Date.now()}-${hashBuffer(buffer).slice(0, 12)}${ext}`;
  const fullPath = path.join(uploadDir, filename);
  await fs.writeFile(fullPath, buffer);
  return fullPath;
}

function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
