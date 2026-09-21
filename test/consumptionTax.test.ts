import { describe, expect, it } from 'vitest';
import { buildConsumptionTaxReturn } from '../src/tax/consumptionTax.js';
import { defaultBusinessProfile } from '../src/types/businessProfile.js';
import type { LedgerSourceInvoice } from '../src/accounting/journal.js';

function inv(overrides: Partial<LedgerSourceInvoice>): LedgerSourceInvoice {
  return {
    id: 'x',
    direction: 'expense',
    issueDate: '2026-04-01',
    category: '消耗品費',
    amountInclTax: 0,
    vendorName: 'テスト',
    paymentMethod: null,
    description: null,
    businessRatio: null,
    taxRate: 0.1,
    taxClass: 'taxable',
    invoiceRegistrationNumber: 'T1234567890123',
    ...overrides,
  };
}

describe('buildConsumptionTaxReturn', () => {
  it('returns a non-applicable result for an exempt business', () => {
    const profile = defaultBusinessProfile(2026);
    const result = buildConsumptionTaxReturn([], profile);
    expect(result.applicable).toBe(false);
  });

  it('computes principle-method tax due from taxable sales and purchases', () => {
    const profile = defaultBusinessProfile(2026);
    profile.consumptionTax.isTaxable = true;
    profile.consumptionTax.method = 'principle';

    const invoices: LedgerSourceInvoice[] = [
      inv({ id: 'sale', direction: 'income', category: '売上高', amountInclTax: 1_100_000 }),
      inv({ id: 'purchase', direction: 'expense', category: '仕入高', amountInclTax: 550_000 }),
    ];
    const result = buildConsumptionTaxReturn(invoices, profile);
    expect(result.applicable).toBe(true);
    expect(result.method).toBe('principle');
    expect(result.outputTax).toBeGreaterThan(0);
    expect(result.inputTax).toBeGreaterThan(0);
    expect(result.totalTax).toBe(result.nationalTax + result.localTax);
  });

  it('applies the simplified-method deemed purchase rate', () => {
    const profile = defaultBusinessProfile(2026);
    profile.consumptionTax.isTaxable = true;
    profile.consumptionTax.method = 'simplified';
    profile.consumptionTax.simplifiedBusinessType = 5; // 50%

    const invoices: LedgerSourceInvoice[] = [
      inv({ id: 'sale', direction: 'income', category: '売上高', amountInclTax: 1_100_000 }),
    ];
    const result = buildConsumptionTaxReturn(invoices, profile);
    expect(result.deemedRate).toBe(0.5);
    expect(result.inputTax).toBe(Math.floor(result.outputTax * 0.5));
  });

  it('excludes outofscope transactions (e.g. wages) from the taxable base', () => {
    const profile = defaultBusinessProfile(2026);
    profile.consumptionTax.isTaxable = true;
    profile.consumptionTax.method = 'principle';

    const invoices: LedgerSourceInvoice[] = [
      inv({ id: 'sale', direction: 'income', category: '売上高', amountInclTax: 1_100_000 }),
      inv({ id: 'wages', direction: 'expense', category: '給料賃金', amountInclTax: 300_000, taxClass: 'outofscope' }),
    ];
    const result = buildConsumptionTaxReturn(invoices, profile);
    // 不課税の給料賃金は仕入税額控除の対象にならないため、控除税額は0のまま
    expect(result.inputTax).toBe(0);
  });
});
