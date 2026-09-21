/**
 * OCR読み取り処理（Gemini Vision呼び出し・プロンプト・パース）。
 * 「ソロAI帳簿」の server.ts (/api/receipt-ocr) を移植し、関数として切り出した。
 */
import { GoogleGenAI, Type } from '@google/genai';

export type Direction = 'income' | 'expense';

export interface OcrItem {
  name: string;
  price: number;
  quantity?: number;
  taxRate?: number;
}

export interface OcrResult {
  documentType: 'receipt' | 'invoice' | 'statement' | 'other';
  merchant: string;
  date: string;
  total: number;
  tax: number;
  amount: number;
  taxRate: number;
  category: string;
  description: string;
  invoiceNumber: string;
  paymentMethod: string;
  confidence: number;
  rawText: string;
  items: OcrItem[];
  /** ISO 4217 通貨コード。円建てなら JPY。 */
  currency: string;
}

let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
}

/** 複数モデルを順に試す。先頭モデルが失敗しても次のモデルにフォールバックする。 */
async function generateWithFallback(ai: GoogleGenAI, config: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>) {
  const models = ['gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
  let lastError: unknown = null;
  for (const model of models) {
    try {
      return await ai.models.generateContent({ ...config, model });
    } catch (err) {
      lastError = err;
      console.warn(`[Gemini OCR] model ${model} failed, trying next fallback`, err);
    }
  }
  throw lastError;
}

function buildPrompt(direction: Direction): string {
  const currentYear = new Date().getFullYear();
  if (direction === 'income') {
    return `あなたは日本の経理入力専用AIです。画像は、ご自身（利用者）が発行した請求書・領収書の控え、または売上の証憑です。画像を読み取り、正確に構造化してください。

【絶対条件】
- 画像に書いてある情報だけを根拠にしてください。読めない項目は空文字または0にし、推測で作らないでください。
- merchant には、請求先・お客様・取引先の名前（宛名）を入れてください。ご自身の氏名・屋号は入れないでください。
- total は実際に請求・受領した総額。
- date は請求日・発行日・入金日。YYYY-MM-DD。和暦は西暦化。年省略時は ${currentYear} 年として処理。
- tax と amount は明記値を優先。税額が明記されない場合のみ税率から計算。
- taxRate は標準10%、軽減税率対象は8%。不明なら0.10。
- documentType は receipt / invoice / statement / other のいずれか。
- invoiceNumber はご自身が発行したインボイス登録番号や請求書番号があれば抽出。
- category は「売上高, 業務委託報酬, 制作費, 商品販売, コンサルティング, 雑収入」から最も妥当なもの。判断できない場合は売上高。
- items は明細が読める場合に商品名・金額・数量・税率を抽出。
- rawText は主要な読み取り文字を要約。
- confidence は0〜1。金額・請求先・日付が明瞭なら高く、手書きや不鮮明なら低くする。
- currency は円建てなら "JPY"。外貨表示の場合はISO 4217の3文字コード（USD, EUR等）。判別できなければ "JPY"。`;
  }
  return `あなたは日本の経理入力専用AIです。画像を読み取り、レシート、領収書、請求書、利用明細・明細書、その他の経理書類を正確に構造化してください。

【絶対条件】
- 画像に書いてある情報だけを根拠にしてください。読めない項目は空文字または0にし、「推測」で店舗名や金額を作らないでください。
- merchant は支払先・店舗名・請求元・発行元の企業名/屋号/店舗名。宛名（「○○様」「上様」）はmerchantにしない。
- total は実際の支払総額/請求総額。預り金・釣銭・小計と混同しない。
- date は取引日・支払日・発行日。YYYY-MM-DD。和暦は西暦化。年省略時は ${currentYear} 年として処理。
- tax と amount は明記値を優先。税額が明記されない場合のみ税率から計算。
- taxRate は標準10%、軽減税率対象は8%。不明なら0.10。
- documentType は receipt / invoice / statement / other のいずれか。
- invoiceNumber は請求書番号、インボイス登録番号(Tから始まる番号)、取引番号など、明確な番号があれば抽出。
- paymentMethod は現金、クレジットカード、電子マネー、振込等が読める場合のみ。
- items は明細が読める場合に商品名・金額・数量・税率を抽出。
- category は「仕入高, 消耗品費, 通信費, 広告宣伝費, 接待交際費, 旅費交通費, 会議費, 新聞図書費, 支払手数料, 地代家賃, 水道光熱費, 外注工賃, 車両費, 研修費, 法定福利費, 福利厚生費, 雑費」から最も妥当なもの（販売用商品や原材料の仕入れは「仕入高」）。ただし画像だけでは判断できない場合は消耗品費。
- rawText は主要な読み取り文字を要約。
- confidence は0〜1。金額・店舗名・日付が明瞭なら高く、手書きや不鮮明なら低くする。
- currency は円建てなら "JPY"。外貨表示の場合はISO 4217の3文字コード（USD, EUR等）。判別できなければ "JPY"。`;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    documentType: { type: Type.STRING },
    merchant: { type: Type.STRING },
    date: { type: Type.STRING },
    total: { type: Type.NUMBER },
    tax: { type: Type.NUMBER },
    amount: { type: Type.NUMBER },
    taxRate: { type: Type.NUMBER },
    category: { type: Type.STRING },
    description: { type: Type.STRING },
    invoiceNumber: { type: Type.STRING },
    paymentMethod: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    rawText: { type: Type.STRING },
    currency: { type: Type.STRING },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          price: { type: Type.NUMBER },
          quantity: { type: Type.NUMBER },
          taxRate: { type: Type.NUMBER },
        },
        required: ['name', 'price'],
      },
    },
  },
  required: ['documentType', 'merchant', 'date', 'total', 'tax', 'amount', 'taxRate', 'category', 'description'],
};

export class OcrUnavailableError extends Error {}

/**
 * 画像/PDFのBase64データをGemini Visionに渡して構造化する。
 * GEMINI_API_KEY未設定の場合は OcrUnavailableError を投げる（呼び出し側は手動入力フォームへフォールバックする）。
 */
export async function runReceiptOcr(params: {
  imageBase64: string; // data URLでも生base64でも可
  mimeType: string;
  direction: Direction;
}): Promise<{ raw: unknown; parsed: OcrResult }> {
  const ai = getGenAI();
  if (!ai) {
    throw new OcrUnavailableError('GEMINI_API_KEY が設定されていないため、OCRは利用できません。');
  }

  const cleanBase64 = params.imageBase64.replace(/^data:[^;]+;base64,/, '').trim();
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
  const mimeType = allowedMimes.includes(params.mimeType) ? params.mimeType : 'image/jpeg';

  const response = await generateWithFallback(ai, {
    contents: {
      parts: [{ inlineData: { mimeType, data: cleanBase64 } }, { text: buildPrompt(params.direction) }],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const raw = JSON.parse(response.text || '{}');
  const parsed = normalizeOcrResult(raw, params.direction);
  return { raw, parsed };
}

/**
 * モデルの生出力を安全な値に丸める。
 *
 * 重要: total/tax/amountがモデルから読み取れている場合は、その値をそのまま採用する
 * （互いに矛盾していても、ここで勝手に辻褄を合わせない）。矛盾の検出は
 * src/lib/taxConsistency.ts の checkTaxConsistency() に一本化する。
 * ここで「安全な値」に丸めるのは、モデルがそもそも値を返さなかった（欠測）場合の
 * 最小限のフォールバック計算のみに限定する。
 */
export function normalizeOcrResult(raw: Record<string, unknown>, direction: Direction): OcrResult {
  const safeTotal = Math.max(0, Number(raw.total) || 0);
  const safeTaxRate = Number(raw.taxRate) === 0.08 ? 0.08 : 0.1;

  const rawTax = Number(raw.tax);
  const safeTax = Number.isFinite(rawTax) && rawTax >= 0
    ? Math.round(rawTax)
    : Math.round(safeTotal - safeTotal / (1 + safeTaxRate)); // taxが欠測のときだけのフォールバック

  const rawAmount = Number(raw.amount);
  const safeAmount = Number.isFinite(rawAmount) && rawAmount >= 0
    ? Math.round(rawAmount)
    : Math.max(0, safeTotal - safeTax); // amountが欠測のときだけのフォールバック

  const documentType = ['receipt', 'invoice', 'statement', 'other'].includes(String(raw.documentType))
    ? (raw.documentType as OcrResult['documentType'])
    : 'other';

  const rawDate = typeof raw.date === 'string' ? raw.date.trim() : '';

  return {
    documentType,
    merchant: typeof raw.merchant === 'string' ? raw.merchant.trim() : '',
    // 日付が読み取れなかった場合は「今日」で埋めず空文字のままにする。
    // 呼び出し側（ingestInvoice.ts）が issueDate=null として扱い、重複検知・経過措置控除率判定・
    // 月次集計を誤らせないようにし、承認キューで「発行日未確認」として要確認に回す。
    date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : '',
    total: safeTotal,
    tax: safeTax,
    amount: safeAmount,
    taxRate: safeTaxRate,
    category:
      typeof raw.category === 'string' && raw.category
        ? raw.category
        : direction === 'income'
          ? '売上高'
          : '消耗品費',
    description: typeof raw.description === 'string' ? raw.description : '',
    invoiceNumber: typeof raw.invoiceNumber === 'string' ? raw.invoiceNumber : '',
    paymentMethod: typeof raw.paymentMethod === 'string' ? raw.paymentMethod : '',
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
    rawText: typeof raw.rawText === 'string' ? raw.rawText : '',
    items: Array.isArray(raw.items) ? (raw.items as OcrItem[]) : [],
    currency: typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'JPY',
  };
}

/**
 * テキスト埋め込み型PDFから抽出済みの本文テキストを、画像を経由せず直接構造化する。
 * Vision呼び出しより低コストかつスキャン誤読のリスクがない。
 */
export async function structureFromText(params: {
  text: string;
  direction: Direction;
}): Promise<{ raw: unknown; parsed: OcrResult }> {
  const ai = getGenAI();
  if (!ai) {
    throw new OcrUnavailableError('GEMINI_API_KEY が設定されていないため、書類の自動構造化は利用できません。');
  }

  const response = await generateWithFallback(ai, {
    contents: {
      parts: [
        { text: `${buildPrompt(params.direction)}\n\n【対象テキスト（PDFから抽出済み）】\n${params.text}` },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const raw = JSON.parse(response.text || '{}');
  const parsed = normalizeOcrResult(raw, params.direction);
  return { raw, parsed };
}
