import { describe, expect, it } from 'vitest';
import { normalizeOcrResult } from '../src/ocr/gemini.js';

describe('normalizeOcrResult', () => {
  it('trusts a self-consistent AI reading as-is', () => {
    const result = normalizeOcrResult(
      { total: 1100, tax: 100, amount: 1000, taxRate: 0.1, merchant: 'テスト', date: '2026-04-01', category: '消耗品費', description: '' },
      'expense'
    );
    expect(result.total).toBe(1100);
    expect(result.tax).toBe(100);
    expect(result.amount).toBe(1000);
  });

  it('does NOT silently overwrite a genuinely inconsistent AI reading (lets checkTaxConsistency flag it downstream)', () => {
    // total=1100, tax=100 (implies amount should be 1000), but the model actually read amount=500 (a real mismatch worth flagging)
    const result = normalizeOcrResult(
      { total: 1100, tax: 100, amount: 500, taxRate: 0.1, merchant: 'テスト', date: '2026-04-01', category: '消耗品費', description: '' },
      'expense'
    );
    expect(result.amount).toBe(500); // preserved as-read, not silently forced to 1000
  });

  it('derives amount only when the model omitted it entirely', () => {
    const result = normalizeOcrResult(
      { total: 1100, tax: 100, taxRate: 0.1, merchant: 'テスト', date: '2026-04-01', category: '消耗品費', description: '' },
      'expense'
    );
    expect(result.amount).toBe(1000); // total - tax, since amount was never provided
  });

  it('derives tax only when the model omitted it entirely', () => {
    const result = normalizeOcrResult(
      { total: 1100, amount: 1000, taxRate: 0.1, merchant: 'テスト', date: '2026-04-01', category: '消耗品費', description: '' },
      'expense'
    );
    expect(result.tax).toBe(100); // total - total/(1+rate)
  });

  it('leaves date empty (not today) when the model could not read one', () => {
    const result = normalizeOcrResult(
      { total: 1100, tax: 100, amount: 1000, taxRate: 0.1, merchant: 'テスト', category: '消耗品費', description: '' },
      'expense'
    );
    expect(result.date).toBe('');
  });

  it('rejects a malformed date string and leaves date empty', () => {
    const result = normalizeOcrResult(
      { total: 1100, tax: 100, amount: 1000, taxRate: 0.1, merchant: 'テスト', date: '読み取れませんでした', category: '消耗品費', description: '' },
      'expense'
    );
    expect(result.date).toBe('');
  });

  it('keeps a well-formed date', () => {
    const result = normalizeOcrResult(
      { total: 1100, tax: 100, amount: 1000, taxRate: 0.1, merchant: 'テスト', date: '2026-04-01', category: '消耗品費', description: '' },
      'expense'
    );
    expect(result.date).toBe('2026-04-01');
  });
});
