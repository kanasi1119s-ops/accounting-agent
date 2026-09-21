import { createHash } from 'node:crypto';

/**
 * 重複請求書検知用ハッシュ: 発行日 + 取引先名 + 金額 から生成する。
 * 取引先名は表記ゆれ（全角/半角、空白、株式会社の位置など）を軽く正規化してから使う。
 */
export function normalizeVendorNameForHash(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/株式会社|有限会社|合同会社|\(株\)|㈱/g, '')
    .toLowerCase();
}

export function computeDedupHash(params: {
  issueDate: string | null; // YYYY-MM-DD
  vendorName: string | null;
  amountInclTax: number | null;
}): string | null {
  if (!params.issueDate || !params.vendorName || params.amountInclTax === null) {
    return null;
  }
  const normalizedVendor = normalizeVendorNameForHash(params.vendorName);
  const payload = `${params.issueDate}|${normalizedVendor}|${Math.round(params.amountInclTax)}`;
  return createHash('sha256').update(payload).digest('hex');
}
