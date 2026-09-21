import { describe, expect, it } from 'vitest';
import { computeDedupHash, normalizeVendorNameForHash } from '../src/lib/dedupHash.js';

describe('computeDedupHash', () => {
  it('produces the same hash for equivalent inputs regardless of vendor name notation', () => {
    const a = computeDedupHash({ issueDate: '2026-04-01', vendorName: '株式会社サンプル', amountInclTax: 1100 });
    const b = computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: 1100 });
    expect(a).toBe(b);
  });

  it('produces different hashes for different amounts', () => {
    const a = computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: 1100 });
    const b = computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: 1200 });
    expect(a).not.toBe(b);
  });

  it('returns null when required fields are missing', () => {
    expect(computeDedupHash({ issueDate: null, vendorName: 'サンプル', amountInclTax: 1100 })).toBeNull();
    expect(computeDedupHash({ issueDate: '2026-04-01', vendorName: null, amountInclTax: 1100 })).toBeNull();
    expect(computeDedupHash({ issueDate: '2026-04-01', vendorName: 'サンプル', amountInclTax: null })).toBeNull();
  });
});

describe('normalizeVendorNameForHash', () => {
  it('strips common corporate suffixes and whitespace', () => {
    expect(normalizeVendorNameForHash('株式会社 サンプル')).toBe('サンプル');
    expect(normalizeVendorNameForHash('(株)サンプル')).toBe('サンプル');
  });
});
