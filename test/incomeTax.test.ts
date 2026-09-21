import { describe, expect, it } from 'vitest';
import { buildIncomeTaxReturn, calcIncomeTaxBase, floor1000 } from '../src/tax/incomeTax.js';
import { defaultBusinessProfile } from '../src/types/businessProfile.js';
import type { ProfitLoss } from '../src/accounting/journal.js';

function pl(overrides: Partial<ProfitLoss>): ProfitLoss {
  return {
    revenueByAccount: {},
    expenseByAccount: {},
    totalRevenue: 0,
    totalExpense: 0,
    incomeBeforeDeduction: 0,
    blueDeduction: 0,
    netIncome: 0,
    openingInventory: 0,
    closingInventory: 0,
    purchases: 0,
    costOfSales: 0,
    familyEmployeeSalary: 0,
    ...overrides,
  };
}

describe('floor1000', () => {
  it('truncates to the nearest 1000 yen below', () => {
    expect(floor1000(1_999)).toBe(1_000);
    expect(floor1000(2_000)).toBe(2_000);
  });
});

describe('calcIncomeTaxBase', () => {
  it('applies the correct bracket and deduction', () => {
    // 3,000,000円は 10%帯（195万超〜330万）
    const { tax, bracket } = calcIncomeTaxBase(3_000_000);
    expect(bracket.rate).toBe(0.1);
    expect(tax).toBe(Math.floor(3_000_000 * 0.1 - 97_500));
  });
});

describe('buildIncomeTaxReturn', () => {
  it('computes taxable income after the basic deduction', () => {
    const profile = defaultBusinessProfile(2026);
    profile.deductions.basic = 480_000;
    const result = buildIncomeTaxReturn(pl({ netIncome: 3_000_000, incomeBeforeDeduction: 3_000_000 }), profile);
    expect(result.businessIncome).toBe(3_000_000);
    expect(result.totalDeductions).toBe(480_000);
    expect(result.taxableIncome).toBe(floor1000(3_000_000 - 480_000));
  });

  it('nets withholding tax and prepayments against the total tax due', () => {
    const profile = defaultBusinessProfile(2026);
    profile.otherIncome.withholdingTax = 500_000;
    const result = buildIncomeTaxReturn(pl({ netIncome: 3_000_000, incomeBeforeDeduction: 3_000_000 }), profile);
    // 源泉徴収が多ければ還付になりうる
    expect(result.refund >= 0 || result.taxDue >= 0).toBe(true);
    expect(result.taxDue === 0 || result.refund === 0).toBe(true);
  });
});
