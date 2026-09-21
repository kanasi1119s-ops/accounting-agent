import { describe, expect, it } from 'vitest';
import { suggestCategory, suggestFromKeywords, suggestFromVendorHistory } from '../src/accounting/categorySuggestion.js';

describe('suggestFromVendorHistory', () => {
  it('returns null when there is no history', () => {
    expect(suggestFromVendorHistory([])).toEqual({ category: null, confidence: 0, source: null });
  });

  it('prefers the most frequently used category and scales confidence with match count', () => {
    const result = suggestFromVendorHistory([
      { category: '消耗品費', matchCount: 1 },
      { category: '通信費', matchCount: 5 },
    ]);
    expect(result.category).toBe('通信費');
    expect(result.source).toBe('vendor_history');
    expect(result.confidence).toBe(99); // min(99, 50 + 5*10) = 99
  });

  it('caps confidence at 99', () => {
    const result = suggestFromVendorHistory([{ category: '通信費', matchCount: 20 }]);
    expect(result.confidence).toBe(99);
  });
});

describe('suggestFromKeywords', () => {
  it('matches common expense keywords', () => {
    expect(suggestFromKeywords('タクシー代', 'expense').category).toBe('旅費交通費');
    expect(suggestFromKeywords('携帯電話料金', 'expense').category).toBe('通信費');
  });

  it('returns null for unmatched text', () => {
    expect(suggestFromKeywords('謎の請求', 'expense').category).toBeNull();
  });

  it('never guesses for income direction', () => {
    expect(suggestFromKeywords('タクシー代', 'income').category).toBeNull();
  });
});

describe('suggestCategory', () => {
  it('prefers vendor history over keyword guessing', () => {
    const result = suggestCategory({
      vendorHistory: [{ category: '会議費', matchCount: 3 }],
      itemText: 'タクシー代',
      direction: 'expense',
    });
    expect(result.category).toBe('会議費');
    expect(result.source).toBe('vendor_history');
  });

  it('falls back to keyword guessing for a first-time vendor', () => {
    const result = suggestCategory({ vendorHistory: [], itemText: 'タクシー代', direction: 'expense' });
    expect(result.category).toBe('旅費交通費');
    expect(result.source).toBe('keyword_guess');
  });
});
