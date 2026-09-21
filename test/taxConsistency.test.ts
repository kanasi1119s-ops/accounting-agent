import { describe, expect, it } from 'vitest';
import { checkTaxConsistency } from '../src/lib/taxConsistency.js';

describe('checkTaxConsistency', () => {
  it('marks consistent amounts as ok', () => {
    const result = checkTaxConsistency({
      amountExclTax: 1000,
      taxAmount: 100,
      amountInclTax: 1100,
      taxRate: 0.1,
    });
    expect(result.status).toBe('ok');
  });

  it('tolerates a 1-yen rounding difference', () => {
    const result = checkTaxConsistency({
      amountExclTax: 909,
      taxAmount: 92,
      amountInclTax: 1000,
      taxRate: 0.1,
    });
    expect(result.status).toBe('ok');
  });

  it('flags a mismatch and does not auto-correct the values', () => {
    const result = checkTaxConsistency({
      amountExclTax: 1000,
      taxAmount: 50, // 本来100円のはずが50円になっている
      amountInclTax: 1100,
      taxRate: 0.1,
    });
    expect(result.status).toBe('mismatch');
    expect(result.discrepancyYen).toBe(-50);
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('is unverified when not enough fields are present', () => {
    const result = checkTaxConsistency({
      amountExclTax: null,
      taxAmount: null,
      amountInclTax: 1100,
      taxRate: 0.1,
    });
    expect(result.status).toBe('unverified');
  });

  it('derives the missing figure from the other two when only one is absent', () => {
    const result = checkTaxConsistency({
      amountExclTax: null,
      taxAmount: 100,
      amountInclTax: 1100,
      taxRate: 0.1,
    });
    expect(result.status).toBe('ok');
  });
});
