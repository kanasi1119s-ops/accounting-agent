import { describe, expect, it } from 'vitest';
import { computeDedupHash, normalizeVendorNameForHash } from '../src/lib/dedupHash.js';

describe('computeDedupHash', () => {
  it('produces the same hash for equivalent inputs regardless of vendor name notation', () => {
    const a = computeDedupHash({ issueDate: '2026-04-01', vendorName: '株式会社サンプル', amountInclTax: 1100, direction: 'expense' });
    const b = computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: 1100, direction: 'expense' });
    expect(a).toBe(b);
  });

  it('produces different hashes for different amounts', () => {
    const a = computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: 1100, direction: 'expense' });
    const b = computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: 1200, direction: 'expense' });
    expect(a).not.toBe(b);
  });

  it('produces different hashes for expense vs income with the same date/vendor/amount', () => {
    const expense = computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: 30000, direction: 'expense' });
    const income = computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: 30000, direction: 'income' });
    expect(expense).not.toBe(income);
  });

  it('returns null when required fields are missing', () => {
    expect(computeDedupHash({ issueDate: null, vendorName: 'サンプル', amountInclTax: 1100, direction: 'expense' })).toBeNull();
    expect(computeDedupHash({ issueDate: '2026-04-01', vendorName: null, amountInclTax: 1100, direction: 'expense' })).toBeNull();
    expect(computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: null, direction: 'expense' })).toBeNull();
  });
});

describe('normalizeVendorNameForHash', () => {
  it('strips common corporate suffixes and whitespace', () => {
    expect(normalizeVendorNameForHash('株式会社 サンプル')).toBe('サンプル');
    expect(normalizeVendorNameForHash('(株)サンプル')).toBe('サンプル');
  });
});
