import { describe, expect, it } from 'vitest';
import {
  businessTotal,
  computeBalanceSheet,
  computeByCounterparty,
  computeProfitLoss,
  toJournalEntry,
} from '../src/accounting/journal.js';
import type { LedgerSourceInvoice } from '../src/accounting/journal.js';
import { defaultBusinessProfile } from '../src/types/businessProfile.js';

const sample: LedgerSourceInvoice[] = [
  {
    id: '1',
    direction: 'income',
    issueDate: '2026-04-10',
    category: '売上高',
    amountInclTax: 110000,
    vendorName: 'クライアントA',
    paymentMethod: '振込',
    description: '制作業務',
    businessRatio: null,
    taxRate: 0.1,
    taxClass: 'taxable',
    invoiceRegistrationNumber: null,
  },
  {
    id: '2',
    direction: 'expense',
    issueDate: '2026-04-12',
    category: '消耗品費',
    amountInclTax: 3300,
    vendorName: '文具店',
    paymentMethod: '現金',
    description: '事務用品',
    businessRatio: null,
    taxRate: 0.1,
    taxClass: 'taxable',
    invoiceRegistrationNumber: null,
  },
];

const allocated: LedgerSourceInvoice = {
  id: '3',
  direction: 'expense',
  issueDate: '2026-04-15',
  category: '水道光熱費',
  amountInclTax: 10000,
  vendorName: '電力会社',
  paymentMethod: '振込',
  description: '電気代',
  businessRatio: 0.6,
  taxRate: 0.1,
  taxClass: 'taxable',
  invoiceRegistrationNumber: null,
};

describe('businessTotal', () => {
  it('treats a missing businessRatio as 100% (no allocation)', () => {
    expect(businessTotal(sample[1])).toBe(3300);
  });

  it('applies the business ratio and rounds to the nearest yen', () => {
    expect(businessTotal(allocated)).toBe(6000);
  });
});

describe('toJournalEntry', () => {
  it('books an expense as debit=category / credit=settlement account', () => {
    const entry = toJournalEntry(sample[1]);
    expect(entry.lines).toEqual([
      { account: '消耗品費', debit: 3300, credit: 0 },
      { account: '現金', debit: 0, credit: 3300 },
    ]);
  });

  it('books income as debit=settlement account / credit=category', () => {
    const entry = toJournalEntry(sample[0]);
    expect(entry.lines).toEqual([
      { account: '普通預金', debit: 110000, credit: 0 },
      { account: '売上高', debit: 0, credit: 110000 },
    ]);
  });

  it('books only the business-use portion when a business ratio is set', () => {
    const entry = toJournalEntry(allocated);
    expect(entry.lines).toEqual([
      { account: '水道光熱費', debit: 6000, credit: 0 },
      { account: '普通預金', debit: 0, credit: 6000 },
    ]);
  });
});

describe('computeProfitLoss', () => {
  it('aggregates revenue and expense by account', () => {
    const pl = computeProfitLoss(sample);
    expect(pl.totalRevenue).toBe(110000);
    expect(pl.totalExpense).toBe(3300);
    expect(pl.netIncome).toBe(106700);
  });

  it('only counts the allocated portion of a business-ratio expense', () => {
    const pl = computeProfitLoss([...sample, allocated]);
    expect(pl.expenseByAccount['水道光熱費']).toBe(6000);
    expect(pl.totalExpense).toBe(3300 + 6000);
  });
});

describe('computeByCounterparty', () => {
  it('sums amounts per vendor for the given direction', () => {
    const rows = computeByCounterparty(sample, 'expense');
    expect(rows).toEqual([{ name: '文具店', amount: 3300, count: 1 }]);
  });
});

describe('computeBalanceSheet', () => {
  it('keeps the balance sheet balanced when a journal entry touches an equity-kind account (e.g. 元入金 capital contribution)', () => {
    const profile = defaultBusinessProfile(2026);
    profile.openingBalances.現金 = 100_000;
    profile.openingBalances.元入金 = 100_000;

    const contribution: LedgerSourceInvoice = {
      id: 'capital',
      direction: 'income',
      issueDate: '2026-05-01',
      category: '元入金',
      amountInclTax: 50_000,
      vendorName: null,
      paymentMethod: '現金',
      description: '事業主からの追加出資',
      businessRatio: null,
      taxRate: null,
      taxClass: 'outofscope',
      invoiceRegistrationNumber: null,
    };

    const pl = computeProfitLoss([contribution], profile);
    const bs = computeBalanceSheet([contribution], profile, pl);

    expect(bs.assetsClosing['現金']).toBe(150_000);
    // 資産側だけ増えて資本側（元入金）が動かないと貸借が一致しなくなる
    expect(bs.equityClosing['元入金']).toBe(150_000);
    expect(bs.balanced).toBe(true);
  });

  it('reduces the 固定資産 closing balance by depreciationExpense so depreciation keeps the sheet balanced', () => {
    const profile = defaultBusinessProfile(2026);
    profile.openingBalances.固定資産 = 300_000;

    const pl = computeProfitLoss([], profile);
    // 固定資産台帳の減価償却は請求書の仕訳を経由しないため、depreciationExpense を
    // 渡さないと固定資産の残高が動かず、所得だけ減って貸借が一致しなくなる。
    const withoutDepreciation = computeBalanceSheet([], profile, pl);
    expect(withoutDepreciation.assetsClosing['固定資産']).toBe(300_000);

    const withDepreciation = computeBalanceSheet([], profile, pl, 75_000);
    expect(withDepreciation.assetsClosing['固定資産']).toBe(225_000);
  });
});
