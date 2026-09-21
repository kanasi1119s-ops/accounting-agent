/**
 * 決算書類作成に使う集計ロジック。「ソロAI帳簿」の src/accounting/journal.ts を、
 * このプロジェクトの invoices テーブル（承認済みレコード）向けに書き換えて移植した。
 *
 * フェーズ1では自動仕訳を行わないため、ここに渡すのは status='approved' の invoice のみを想定する。
 */
import { accountKind } from './accounts.js';

export interface LedgerSourceInvoice {
  id: string;
  direction: 'income' | 'expense';
  issueDate: string; // YYYY-MM-DD
  category: string | null;
  amountInclTax: number;
  vendorName: string | null;
  paymentMethod: string | null;
  description: string | null;
}

export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  invoiceId: string;
  date: string;
  description: string;
  counterparty: string | null;
  lines: JournalLine[];
}

/** 支払方法の文字列を決済手段の勘定科目名に正規化する */
export function normalizeSettlement(raw: string | null, direction: 'income' | 'expense'): string {
  const s = (raw || '').trim();
  const fallback = direction === 'income' ? '普通預金' : '現金';
  if (!s) return fallback;
  if (/現金|キャッシュ|cash/i.test(s)) return '現金';
  if (/クレジット|credit|カード|card/i.test(s)) return 'クレジットカード';
  if (/振込|振替|口座|預金|銀行|bank/i.test(s)) return '普通預金';
  if (/売掛|請求|後日入金/.test(s)) return '売掛金';
  if (/買掛/.test(s)) return '買掛金';
  if (/未払/.test(s)) return '未払金';
  return fallback;
}

/** 税込経理を既定とし、消費税は本体科目に含めて1行にまとめる（決算書の表示と一致させるため） */
export function toJournalEntry(inv: LedgerSourceInvoice): JournalEntry {
  const settlement = normalizeSettlement(inv.paymentMethod, inv.direction);
  const category = inv.category || (inv.direction === 'income' ? '売上高' : '雑費');
  const gross = Math.round(inv.amountInclTax);

  const lines: JournalLine[] =
    inv.direction === 'expense'
      ? [
          { account: category, debit: gross, credit: 0 },
          { account: settlement, debit: 0, credit: gross },
        ]
      : [
          { account: settlement, debit: gross, credit: 0 },
          { account: category, debit: 0, credit: gross },
        ];

  return {
    invoiceId: inv.id,
    date: inv.issueDate,
    description: inv.description || inv.vendorName || '',
    counterparty: inv.vendorName,
    lines,
  };
}

export function buildJournal(invoices: LedgerSourceInvoice[]): JournalEntry[] {
  return invoices.map(toJournalEntry).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface ProfitLoss {
  revenueByAccount: Record<string, number>;
  expenseByAccount: Record<string, number>;
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
}

export function computeProfitLoss(invoices: LedgerSourceInvoice[]): ProfitLoss {
  const revenueByAccount: Record<string, number> = {};
  const expenseByAccount: Record<string, number> = {};

  for (const inv of invoices) {
    const key = inv.category || (inv.direction === 'income' ? '売上高' : '雑費');
    const value = Math.round(inv.amountInclTax);
    if (inv.direction === 'income') {
      revenueByAccount[key] = (revenueByAccount[key] || 0) + value;
    } else {
      expenseByAccount[key] = (expenseByAccount[key] || 0) + value;
    }
  }

  const totalRevenue = Object.values(revenueByAccount).reduce((a, b) => a + b, 0);
  const totalExpense = Object.values(expenseByAccount).reduce((a, b) => a + b, 0);

  return {
    revenueByAccount,
    expenseByAccount,
    totalRevenue,
    totalExpense,
    netIncome: totalRevenue - totalExpense,
  };
}

/** 取引先別の集計（決算書付属明細・請求先ごとの年間取引額確認などに使用） */
export function computeByCounterparty(
  invoices: LedgerSourceInvoice[],
  direction: 'income' | 'expense'
): { name: string; amount: number; count: number }[] {
  const map = new Map<string, { amount: number; count: number }>();
  for (const inv of invoices) {
    if (inv.direction !== direction) continue;
    const name = (inv.vendorName || '').trim() || '（取引先未確定）';
    const cur = map.get(name) || { amount: 0, count: 0 };
    cur.amount += Math.round(inv.amountInclTax);
    cur.count += 1;
    map.set(name, cur);
  }
  return Array.from(map, ([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount);
}

export interface MonthlySummary {
  month: number;
  revenue: number;
  expense: number;
  profit: number;
}

export function computeMonthly(invoices: LedgerSourceInvoice[]): MonthlySummary[] {
  const months: MonthlySummary[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    revenue: 0,
    expense: 0,
    profit: 0,
  }));

  for (const inv of invoices) {
    const m = Number((inv.issueDate || '').slice(5, 7));
    if (!m || m < 1 || m > 12) continue;
    const value = Math.round(inv.amountInclTax);
    if (inv.direction === 'income') months[m - 1].revenue += value;
    else months[m - 1].expense += value;
  }
  months.forEach((m) => (m.profit = m.revenue - m.expense));
  return months;
}

// accountKind is re-exported for callers that need to distinguish B/S vs P/L accounts.
export { accountKind };
