/**
 * インボイス制度対応: 登録番号の形式チェックと、経過措置による仕入税額控除率の判定。
 *
 * 「ソロAI帳簿」側には形式チェックの実装は存在しなかった（UIのプレースホルダー文言のみ）ため、
 * ここで新規に実装する。
 */

const INVOICE_NUMBER_PATTERN = /^T\d{13}$/;

export interface InvoiceNumberCheckResult {
  /** ユーザーが未入力・空文字だった場合は null（=未登録事業者の可能性、というより「番号なし」） */
  normalized: string | null;
  /** T+13桁の形式に一致するか */
  isValidFormat: boolean;
}

/** 全角数字・全角Tなどを半角に正規化してから形式チェックする */
export function checkInvoiceRegistrationNumber(raw: string | null | undefined): InvoiceNumberCheckResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { normalized: null, isValidFormat: false };
  }

  const normalized = trimmed
    .normalize('NFKC') // 全角英数字を半角に統一
    .toUpperCase()
    .replace(/\s+/g, '');

  return {
    normalized,
    isValidFormat: INVOICE_NUMBER_PATTERN.test(normalized),
  };
}

export type VendorRegistrationStatus = 'registered' | 'unregistered' | 'unknown';

/**
 * 取引先の登録状況を判定する。
 * - vendorマスタに登録済みステータスがあればそれを優先
 * - なければ、証憑上のインボイス番号が正しい形式かどうかで判断
 */
export function resolveVendorRegistrationStatus(params: {
  vendorMasterStatus?: 'registered' | 'exempt' | 'unknown';
  invoiceNumberOnDocument?: string | null;
}): VendorRegistrationStatus {
  if (params.vendorMasterStatus === 'registered') return 'registered';
  if (params.vendorMasterStatus === 'exempt') return 'unregistered';

  const { isValidFormat, normalized } = checkInvoiceRegistrationNumber(params.invoiceNumberOnDocument);
  if (normalized === null) return 'unknown';
  return isValidFormat ? 'registered' : 'unregistered';
}

/**
 * 免税事業者等（インボイス未登録）からの仕入れに対する経過措置の仕入税額控除率。
 * 参照: 2023-10-01の適格請求書等保存方式開始後の経過措置スケジュール。
 *   2023-10-01 〜 2026-09-30: 仕入税額相当額の80%控除
 *   2026-10-01 〜 2029-09-30: 仕入税額相当額の50%控除
 *   2029-10-01 〜          : 控除なし（0%）
 * 登録事業者からの仕入れ、または判定不能（unknown）の場合は null を返す
 * （unknown はUI側で「要確認」表示にする想定で、勝手に100%控除とみなさない）。
 */
export function resolveDeemedDeductionRate(
  status: VendorRegistrationStatus,
  issueDate: Date | string | null
): number | null {
  if (status !== 'unregistered') return null;
  if (!issueDate) return null;

  const d = typeof issueDate === 'string' ? new Date(issueDate) : issueDate;
  if (Number.isNaN(d.getTime())) return null;

  const PHASE1_START = new Date('2023-10-01T00:00:00+09:00');
  const PHASE2_START = new Date('2026-10-01T00:00:00+09:00');
  const PHASE3_START = new Date('2029-10-01T00:00:00+09:00');

  if (d < PHASE1_START) return null; // 制度開始前
  if (d < PHASE2_START) return 0.8;
  if (d < PHASE3_START) return 0.5;
  return 0;
}
