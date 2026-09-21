/**
 * 決算書類作成に使う集計ロジック。「ソロAI帳簿」の src/accounting/journal.ts を、
 * このプロジェクトの invoices テーブル（承認済みレコード）向けに書き換えて移植した。
 *
 * フェーズ1では自動仕訳を行わないため、ここに渡すのは status='approved' の invoice のみを想定する。
 */
import { accountKind } from './accounts.js';
import type { BusinessProfile } from '../types/businessProfile.js';

export interface LedgerSourceInvoice {
  id: string;
  direction: 'income' | 'expense';
  issueDate: string; // YYYY-MM-DD
  category: string | null;
  amountInclTax: number;
  vendorName: string | null;
  paymentMethod: string | null;
  description: string | null;
  /** 家事按分比率（0-1）。未設定（null）は100%（按分なし）として扱う。 */
  businessRatio: number | null;
  /** 消費税申告書の集計に使う（未指定なら0.1として扱う） */
  taxRate: number | null;
  /** 消費税の課税区分（未指定なら課税扱い） */
  taxClass: 'taxable' | 'nontaxable' | 'outofscope' | null;
  invoiceRegistrationNumber: string | null;
}

/** 家事按分後の税込金額。「ソロAI帳簿」の businessTotal() 相当。 */
export function businessTotal(inv: LedgerSourceInvoice): number {
  const ratio = typeof inv.businessRatio === 'number' ? Math.min(1, Math.max(0, inv.businessRatio)) : 1;
  return Math.round(inv.amountInclTax * ratio);
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
  const gross = businessTotal(inv);

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
  /** 青色申告特別控除前の所得金額 */
  incomeBeforeDeduction: number;
  blueDeduction: number;
  /** 青色申告特別控除後の所得金額（＝事業所得） */
  netIncome: number;
  openingInventory: number;
  closingInventory: number;
  purchases: number;
  costOfSales: number;
  familyEmployeeSalary: number;
}

/** 資産・負債・資本科目は貸借対照表の動きであって損益ではないため、損益計算から除外する */
export function isBalanceSheetCategory(category: string | null): boolean {
  if (!category) return false;
  const kind = accountKind(category, 'expense');
  return kind === 'asset' || kind === 'liability' || kind === 'equity';
}

/**
 * 損益計算書を計算する。青色申告特別控除・専従者給与・期首期末棚卸高は
 * BusinessProfile（未指定ならデフォルト値=0扱い）から取り込む。
 */
export function computeProfitLoss(invoices: LedgerSourceInvoice[], profile?: BusinessProfile): ProfitLoss {
  const revenueByAccount: Record<string, number> = {};
  const expenseByAccount: Record<string, number> = {};
  const plInvoices = invoices.filter((inv) => !isBalanceSheetCategory(inv.category));

  for (const inv of plInvoices) {
    const key = inv.category || (inv.direction === 'income' ? '売上高' : '雑費');
    const value = businessTotal(inv);
    if (inv.direction === 'income') {
      revenueByAccount[key] = (revenueByAccount[key] || 0) + value;
    } else {
      expenseByAccount[key] = (expenseByAccount[key] || 0) + value;
    }
  }

  const familyEmployeeSalary = profile?.hasFamilyEmployee ? Math.max(0, Number(profile.familyEmployeeSalary) || 0) : 0;
  if (familyEmployeeSalary > 0) {
    expenseByAccount['専従者給与'] = (expenseByAccount['専従者給与'] || 0) + familyEmployeeSalary;
  }

  const openingInventory = Math.max(0, Number(profile?.openingBalances?.棚卸資産) || 0);
  const closingInventory = Math.max(0, Number(profile?.closingInventory) || 0);
  const purchases = expenseByAccount['仕入高'] || 0;
  const costOfSales = openingInventory + purchases - closingInventory;

  const totalRevenue = Object.values(revenueByAccount).reduce((a, b) => a + b, 0);
  const totalExpense = Object.entries(expenseByAccount)
    .filter(([k]) => k !== '仕入高')
    .reduce((a, [, v]) => a + v, 0);

  const incomeBeforeDeduction = Math.round(totalRevenue - costOfSales - totalExpense);
  const blueDeduction =
    profile?.filingType === 'blue' ? Math.min(Math.max(0, incomeBeforeDeduction), profile.blueDeduction) : 0;
  const netIncome = Math.max(0, incomeBeforeDeduction - blueDeduction);

  return {
    revenueByAccount,
    expenseByAccount,
    totalRevenue,
    totalExpense,
    incomeBeforeDeduction,
    blueDeduction,
    netIncome,
    openingInventory,
    closingInventory,
    purchases,
    costOfSales,
    familyEmployeeSalary,
  };
}

/* ============================================================
   貸借対照表
   ============================================================ */

const ASSET_KEYS = ['現金', '普通預金', '売掛金', '棚卸資産', '固定資産', 'その他資産'] as const;
const LIABILITY_KEYS = ['買掛金', '未払金', '借入金', 'その他負債'] as const;

export interface BalanceSheet {
  assetsOpening: Record<string, number>;
  assetsClosing: Record<string, number>;
  liabilitiesOpening: Record<string, number>;
  liabilitiesClosing: Record<string, number>;
  equityOpening: Record<string, number>;
  equityClosing: Record<string, number>;
  totalAssetsOpening: number;
  totalAssetsClosing: number;
  totalLiabilitiesOpening: number;
  totalLiabilitiesClosing: number;
  netIncome: number;
  balanced: boolean;
  difference: number;
}

/**
 * 貸借対照表を計算する。期首残高はBusinessProfile.openingBalancesから、
 * 期中の増減は承認済み仕訳（buildJournal）から積み上げる。
 * computeProfitLoss と異なり profile は必須（省略不可）：期首残高がないと
 * 資産・負債の起点が定まらず貸借対照表そのものが作れないため。
 *
 * depreciationExpense（当年分の減価償却費、事業割合適用後）を渡した場合、固定資産の
 * 期末残高からその分を差し引く。固定資産台帳の減価償却は請求書の仕訳を経由しないため、
 * これを渡さないと pl.incomeBeforeDeduction だけ償却費分減って資産側が動かず貸借が
 * 一致しなくなる。
 */
export function computeBalanceSheet(
  invoices: LedgerSourceInvoice[],
  profile: BusinessProfile,
  pl: ProfitLoss,
  depreciationExpense = 0
): BalanceSheet {
  const ob = profile.openingBalances;

  const assetsOpening: Record<string, number> = {};
  ASSET_KEYS.forEach((k) => (assetsOpening[k] = Math.max(0, Number(ob[k]) || 0)));
  const liabilitiesOpening: Record<string, number> = {};
  LIABILITY_KEYS.forEach((k) => (liabilitiesOpening[k] = Math.max(0, Number(ob[k]) || 0)));

  const totalAssetsOpening = Object.values(assetsOpening).reduce((a, b) => a + b, 0);
  const totalLiabilitiesOpening = Object.values(liabilitiesOpening).reduce((a, b) => a + b, 0);
  const capital =
    typeof ob.元入金 === 'number' && !Number.isNaN(ob.元入金) ? ob.元入金 : totalAssetsOpening - totalLiabilitiesOpening;

  const entries = buildJournal(invoices);
  const delta: Record<string, number> = {};
  let equityDelta = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      const kind = accountKind(l.account);
      if (kind === 'asset') delta[l.account] = (delta[l.account] || 0) + l.debit - l.credit;
      else if (kind === 'liability') delta[l.account] = (delta[l.account] || 0) + l.credit - l.debit;
      // 元入金など資本科目を相手科目にした仕訳（例：事業主からの出資・払戻を直接記録した場合）も
      // 貸借対照表の期末残高に反映しないと、資産側だけ動いて貸借が一致しなくなる。
      else if (kind === 'equity') equityDelta += l.credit - l.debit;
    }
  }

  const assetsClosing: Record<string, number> = { ...assetsOpening };
  const liabilitiesClosing: Record<string, number> = { ...liabilitiesOpening };

  for (const [acc, d] of Object.entries(delta)) {
    const kind = accountKind(acc);
    if (kind === 'asset') {
      const key = (ASSET_KEYS as readonly string[]).includes(acc) ? acc : acc === '事業主貸' ? '事業主貸' : 'その他資産';
      assetsClosing[key] = (assetsClosing[key] || 0) + d;
    } else if (kind === 'liability') {
      const key =
        acc === 'クレジットカード'
          ? '未払金'
          : (LIABILITY_KEYS as readonly string[]).includes(acc)
            ? acc
            : acc === '事業主借'
              ? '事業主借'
              : 'その他負債';
      liabilitiesClosing[key] = (liabilitiesClosing[key] || 0) + d;
    }
  }

  assetsClosing['棚卸資産'] = pl.closingInventory;
  assetsClosing['固定資産'] = Math.max(0, (assetsClosing['固定資産'] || 0) - Math.max(0, depreciationExpense));

  const totalAssetsClosing = Object.values(assetsClosing).reduce((a, b) => a + b, 0);
  const totalLiabilitiesClosing = Object.values(liabilitiesClosing).reduce((a, b) => a + b, 0);

  const equityOpening = { 元入金: capital };
  const equityClosing = {
    元入金: capital + equityDelta,
    青色申告特別控除前の所得金額: pl.incomeBeforeDeduction,
  };

  const rightClosing = totalLiabilitiesClosing + capital + equityDelta + pl.incomeBeforeDeduction;
  const difference = Math.round(totalAssetsClosing - rightClosing);

  return {
    assetsOpening,
    assetsClosing,
    liabilitiesOpening,
    liabilitiesClosing,
    equityOpening,
    equityClosing,
    totalAssetsOpening,
    totalAssetsClosing,
    totalLiabilitiesOpening,
    totalLiabilitiesClosing,
    netIncome: pl.incomeBeforeDeduction,
    balanced: Math.abs(difference) <= 1,
    difference,
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
    cur.amount += businessTotal(inv);
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
    const value = businessTotal(inv);
    if (inv.direction === 'income') months[m - 1].revenue += value;
    else months[m - 1].expense += value;
  }
  months.forEach((m) => (m.profit = m.revenue - m.expense));
  return months;
}

// accountKind is re-exported for callers that need to distinguish B/S vs P/L accounts.
export { accountKind };
