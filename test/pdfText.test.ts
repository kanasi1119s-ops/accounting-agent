import { describe, expect, it } from 'vitest';
import { checkMultiPageTotal } from '../src/ocr/pdfText.js';

describe('checkMultiPageTotal', () => {
  it('skips single-page documents', () => {
    const result = checkMultiPageTotal(['小計: ¥1,000'], 1000);
    expect(result.checked).toBe(false);
  });

  it('flags a mismatch when page subtotals do not sum to the grand total', () => {
    const result = checkMultiPageTotal(['小計 ¥3,000', '小計 ¥4,000'], 6000);
    expect(result.checked).toBe(true);
    expect(result.sumOfPageSubtotals).toBe(7000);
    expect(result.mismatch).toBe(true);
  });

  it('passes when page subtotals reconcile with the grand total', () => {
    const result = checkMultiPageTotal(['小計 ¥3,000', 'ページ計 ¥4,000'], 7000);
    expect(result.checked).toBe(true);
    expect(result.mismatch).toBe(false);
  });

  it('skips silently when a page has no detectable subtotal', () => {
    const result = checkMultiPageTotal(['小計 ¥3,000', 'よくわからないページ'], 7000);
    expect(result.checked).toBe(false);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('does not mistake the grand-total line ("合計") for a page subtotal', () => {
    // 最終ページに小計と総合計の両方が載っているケース。「合計」にはマッチさせず、
    // 小計が見つからないページとしてスキップする（誤ってページ小計と誤認しない）。
    const result = checkMultiPageTotal(['小計 ¥3,000', '小計 ¥4,000 ... 合計 ¥50,000'], 7000);
    expect(result.checked).toBe(true);
    expect(result.sumOfPageSubtotals).toBe(7000);
    expect(result.mismatch).toBe(false);
  });
});
