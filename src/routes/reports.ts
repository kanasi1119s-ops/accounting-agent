import { Router } from 'express';
import { listApprovedInvoicesInRange } from '../repositories/invoiceRepo.js';
import { listFixedAssets } from '../repositories/fixedAssetRepo.js';
import { getBusinessProfile } from '../repositories/businessProfileRepo.js';
import {
  accountKind,
  buildJournal,
  computeBalanceSheet,
  computeByCounterparty,
  computeMonthly,
  computeProfitLoss,
  type LedgerSourceInvoice,
  type ProfitLoss,
} from '../accounting/journal.js';
import { calculateDepreciationForYear } from '../accounting/depreciation.js';
import { buildConsumptionTaxReturn } from '../tax/consumptionTax.js';
import { buildIncomeTaxReturn } from '../tax/incomeTax.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import type { BusinessProfile } from '../types/businessProfile.js';

export function reportsRouter(): Router {
  const router = Router();

  router.get('/profit-loss', asyncHandler(async (req, res) => {
    const { from, to } = requireRange(req.query);
    if (!from || !to) return res.status(400).json({ success: false, error: 'from, to (YYYY-MM-DD) が必要です。' });

    const sourceInvoices = await loadLedgerSource(from, to);
    const year = Number(from.slice(0, 4));
    const profile = await getBusinessProfile(year);
    res.json({
      success: true,
      data: {
        profitLoss: computeProfitLoss(sourceInvoices, profile),
        monthly: computeMonthly(sourceInvoices),
      },
    });
  }));

  router.get('/by-counterparty', asyncHandler(async (req, res) => {
    const { from, to } = requireRange(req.query);
    const direction = req.query.direction === 'income' ? 'income' : 'expense';
    if (!from || !to) return res.status(400).json({ success: false, error: 'from, to (YYYY-MM-DD) が必要です。' });

    const sourceInvoices = await loadLedgerSource(from, to);
    res.json({ success: true, data: computeByCounterparty(sourceInvoices, direction) });
  }));

  // 貸借対照表（期首残高はその年のBusinessProfileから）。所得税試算と同じ損益
  // （減価償却費を反映済み）を使わないと、両画面で所得金額が食い違ってしまう。
  router.get('/balance-sheet', asyncHandler(async (req, res) => {
    const year = requireYear(req.query);
    if (!year) return res.status(400).json({ success: false, error: 'year (YYYY) が必要です。' });

    const { from, to } = fiscalRange(year);
    const sourceInvoices = await loadLedgerSource(from, to);
    const profile = await getBusinessProfile(year);
    const { pl, depreciation } = await computeYearlyProfitLoss(sourceInvoices, profile, year);
    res.json({
      success: true,
      data: { balanceSheet: computeBalanceSheet(sourceInvoices, profile, pl, depreciation), profitLoss: pl },
    });
  }));

  // 消費税申告書試算
  router.get('/consumption-tax', asyncHandler(async (req, res) => {
    const year = requireYear(req.query);
    if (!year) return res.status(400).json({ success: false, error: 'year (YYYY) が必要です。' });

    const { from, to } = fiscalRange(year);
    const sourceInvoices = await loadLedgerSource(from, to);
    const profile = await getBusinessProfile(year);
    res.json({ success: true, data: buildConsumptionTaxReturn(sourceInvoices, profile) });
  }));

  // 所得税（確定申告）試算。減価償却費・固定資産台帳の当年分も損益に反映する。
  router.get('/income-tax', asyncHandler(async (req, res) => {
    const year = requireYear(req.query);
    if (!year) return res.status(400).json({ success: false, error: 'year (YYYY) が必要です。' });

    const { from, to } = fiscalRange(year);
    const sourceInvoices = await loadLedgerSource(from, to);
    const profile = await getBusinessProfile(year);
    const { pl, depreciation } = await computeYearlyProfitLoss(sourceInvoices, profile, year);

    res.json({ success: true, data: { incomeTax: buildIncomeTaxReturn(pl, profile), profitLoss: pl, depreciation } });
  }));

  // 固定資産の当年分減価償却明細
  router.get('/depreciation', asyncHandler(async (req, res) => {
    const year = requireYear(req.query);
    if (!year) return res.status(400).json({ success: false, error: 'year (YYYY) が必要です。' });

    const assets = await listFixedAssets();
    const rows = assets.map((a) => ({
      asset: a,
      result: calculateDepreciationForYear(a, year),
    }));
    res.json({ success: true, data: rows });
  }));

  // 仕訳日記帳CSV（弥生会計・freee・マネーフォワード等の取込フォーマットに近い一般形式）
  router.get('/journal-csv', asyncHandler(async (req, res) => {
    const year = requireYear(req.query);
    if (!year) return res.status(400).json({ success: false, error: 'year (YYYY) が必要です。' });
    const { from, to } = fiscalRange(year);
    const sourceInvoices = await loadLedgerSource(from, to);
    const entries = buildJournal(sourceInvoices);

    const headers = ['日付', '借方勘定科目', '借方金額', '貸方勘定科目', '貸方金額', '摘要', '取引先'];
    const rows: (string | number)[][] = [];
    for (const e of entries) {
      const debits = e.lines.filter((l) => l.debit > 0);
      const credits = e.lines.filter((l) => l.credit > 0);
      const max = Math.max(debits.length, credits.length);
      for (let i = 0; i < max; i++) {
        rows.push([
          e.date,
          debits[i]?.account ?? '',
          debits[i]?.debit ?? 0,
          credits[i]?.account ?? '',
          credits[i]?.credit ?? 0,
          i === 0 ? e.description : '',
          i === 0 ? e.counterparty ?? '' : '',
        ]);
      }
    }
    sendCsv(res, headers, rows, `仕訳日記帳_${year}.csv`);
  }));

  // 総勘定元帳CSV
  router.get('/general-ledger-csv', asyncHandler(async (req, res) => {
    const year = requireYear(req.query);
    if (!year) return res.status(400).json({ success: false, error: 'year (YYYY) が必要です。' });
    const { from, to } = fiscalRange(year);
    const sourceInvoices = await loadLedgerSource(from, to);
    const entries = buildJournal(sourceInvoices);

    const running: Record<string, number> = {};
    const headers = ['勘定科目', '日付', '相手科目', '摘要', '借方', '貸方', '残高'];
    const rows: (string | number)[][] = [];
    for (const e of entries) {
      for (const l of e.lines) {
        const contra = e.lines.find((x) => x.account !== l.account)?.account || '諸口';
        const kind = accountKind(l.account);
        const delta = kind === 'asset' || kind === 'expense' ? l.debit - l.credit : l.credit - l.debit;
        running[l.account] = (running[l.account] || 0) + delta;
        rows.push([l.account, e.date, contra, e.description, l.debit, l.credit, running[l.account]]);
      }
    }
    sendCsv(res, headers, rows, `総勘定元帳_${year}.csv`);
  }));

  // 消費税区分別集計CSV（インボイス／区分記載の保存要件対応）
  router.get('/tax-class-csv', asyncHandler(async (req, res) => {
    const year = requireYear(req.query);
    if (!year) return res.status(400).json({ success: false, error: 'year (YYYY) が必要です。' });
    const { from, to } = fiscalRange(year);
    const rows = await listApprovedInvoicesInRange(from, to);

    const headers = ['日付', '区分', '取引先', '勘定科目', '摘要', '税率', '税抜金額', '消費税額', '税込金額', '登録番号'];
    const csvRows = rows.map((r: any) => [
      r.issue_date,
      r.direction === 'income' ? '売上' : '経費',
      r.vendor_name || r.vendor_name_raw || '',
      r.category || '',
      r.description || '',
      `${Math.round(Number(r.tax_rate ?? 0.1) * 100)}%`,
      Math.round(Number(r.amount_excl_tax) || 0),
      Math.round(Number(r.tax_amount) || 0),
      Math.round(Number(r.amount_incl_tax) || 0),
      r.invoice_registration_number || '',
    ]);
    sendCsv(res, headers, csvRows, `消費税区分別集計_${year}.csv`);
  }));

  return router;
}

async function computeDepreciationExpense(year: number): Promise<number> {
  const assets = await listFixedAssets();
  return assets.reduce((sum, a) => sum + calculateDepreciationForYear(a, year).businessPortionDepreciation, 0);
}

/**
 * 減価償却費を反映した損益を計算する。貸借対照表・所得税試算のどちらも必ずこれを
 * 経由することで、両画面の所得金額（＝当期の元入金増減）が食い違わないようにする。
 */
async function computeYearlyProfitLoss(
  sourceInvoices: LedgerSourceInvoice[],
  profile: BusinessProfile,
  year: number
): Promise<{ pl: ProfitLoss; depreciation: number }> {
  const depreciation = await computeDepreciationExpense(year);
  const pl = computeProfitLoss(sourceInvoices, profile);
  if (depreciation > 0) {
    pl.expenseByAccount['減価償却費'] = (pl.expenseByAccount['減価償却費'] || 0) + depreciation;
    pl.totalExpense += depreciation;
    pl.incomeBeforeDeduction = Math.round(pl.incomeBeforeDeduction - depreciation);
    const blueDeduction =
      profile.filingType === 'blue' ? Math.min(Math.max(0, pl.incomeBeforeDeduction), profile.blueDeduction) : 0;
    pl.blueDeduction = blueDeduction;
    pl.netIncome = Math.max(0, pl.incomeBeforeDeduction - blueDeduction);
  }
  return { pl, depreciation };
}

async function loadLedgerSource(from: string, to: string): Promise<LedgerSourceInvoice[]> {
  const rows = await listApprovedInvoicesInRange(from, to);
  return rows.map(toLedgerSource);
}

function fiscalRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_PATTERN = /^\d{4}$/;

function requireRange(query: Record<string, unknown>): { from: string | null; to: string | null } {
  const from = typeof query.from === 'string' && DATE_PATTERN.test(query.from) ? query.from : null;
  const to = typeof query.to === 'string' && DATE_PATTERN.test(query.to) ? query.to : null;
  return { from, to };
}

function requireYear(query: Record<string, unknown>): number | null {
  const year = typeof query.year === 'string' && YEAR_PATTERN.test(query.year) ? Number(query.year) : null;
  return year;
}

function sendCsv(res: import('express').Response, headers: string[], rows: (string | number)[][], filename: string) {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const BOM = '﻿';
  const content =
    BOM +
    [headers.map(cell).join(','), ...rows.map((r) => r.map((c) => (typeof c === 'number' ? c : cell(c))).join(','))].join(
      '\r\n'
    );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(content);
}

function toLedgerSource(row: any): LedgerSourceInvoice {
  return {
    id: row.id,
    direction: row.direction,
    issueDate: row.issue_date,
    category: row.category,
    amountInclTax: Number(row.amount_incl_tax) || 0,
    vendorName: row.vendor_name || row.vendor_name_raw || null,
    paymentMethod: row.payment_method,
    description: row.description,
    businessRatio: row.business_ratio === null ? null : Number(row.business_ratio),
    taxRate: row.tax_rate === null ? null : Number(row.tax_rate),
    taxClass: row.tax_class ?? 'taxable',
    invoiceRegistrationNumber: row.invoice_registration_number,
  };
}
