import { describe, expect, it } from 'vitest';
import { computeByCounterparty, computeProfitLoss, toJournalEntry } from '../src/accounting/journal.js';
import type { LedgerSourceInvoice } from '../src/accounting/journal.js';

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
  },
];

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
});

describe('computeProfitLoss', () => {
  it('aggregates revenue and expense by account', () => {
    const pl = computeProfitLoss(sample);
    expect(pl.totalRevenue).toBe(110000);
    expect(pl.totalExpense).toBe(3300);
    expect(pl.netIncome).toBe(106700);
  });
});

describe('computeByCounterparty', () => {
  it('sums amounts per vendor for the given direction', () => {
    const rows = computeByCounterparty(sample, 'expense');
    expect(rows).toEqual([{ name: '文具店', amount: 3300, count: 1 }]);
  });
});
