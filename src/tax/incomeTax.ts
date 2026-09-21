/**
 * 所得税（確定申告）の試算ロジック。「ソロAI帳簿」の src/tax/incomeTax.ts を移植。
 */
import type { BusinessProfile } from '../types/businessProfile.js';
import type { ProfitLoss } from '../accounting/journal.js';

/**
 * 所得税の速算表。
 * 税制は毎年改正されるため、値は編集可能な定数として切り出している。
 * 実際の申告前には必ず国税庁の最新資料で税率・控除額を確認すること。
 */
export interface TaxBracket {
  upTo: number;
  rate: number;
  deduction: number;
}

export const INCOME_TAX_BRACKETS: TaxBracket[] = [
  { upTo: 1_949_000, rate: 0.05, deduction: 0 },
  { upTo: 3_299_000, rate: 0.10, deduction: 97_500 },
  { upTo: 6_949_000, rate: 0.20, deduction: 427_500 },
  { upTo: 8_999_000, rate: 0.23, deduction: 636_000 },
  { upTo: 17_999_000, rate: 0.33, deduction: 1_536_000 },
  { upTo: 39_999_000, rate: 0.40, deduction: 2_796_000 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.45, deduction: 4_796_000 },
];

/** 復興特別所得税率 */
export const RECONSTRUCTION_SURTAX_RATE = 0.021;

export const floor1000 = (n: number) => Math.floor(Math.max(0, n) / 1000) * 1000;
export const floor100 = (n: number) => Math.floor(Math.max(0, n) / 100) * 100;

export function calcIncomeTaxBase(taxableIncome: number): { tax: number; bracket: TaxBracket } {
  const base = floor1000(taxableIncome);
  const bracket = INCOME_TAX_BRACKETS.find((b) => base <= b.upTo) || INCOME_TAX_BRACKETS.at(-1)!;
  const tax = Math.max(0, Math.floor(base * bracket.rate - bracket.deduction));
  return { tax, bracket };
}

/** 確定申告書 第一表に対応する計算結果 */
export interface IncomeTaxReturn {
  businessRevenue: number;
  salaryRevenue: number;
  businessIncome: number;
  salaryIncome: number;
  miscIncome: number;
  totalIncome: number;
  socialInsurance: number;
  smallBusinessMutualAid: number;
  lifeInsurance: number;
  earthquakeInsurance: number;
  otherPersonal: number;
  spouse: number;
  dependent: number;
  basic: number;
  medical: number;
  donation: number;
  totalDeductions: number;
  taxableIncome: number;
  taxOnIncome: number;
  taxCredit: number;
  taxAfterCredit: number;
  reconstructionSurtax: number;
  totalTax: number;
  withholdingTax: number;
  estimatedPrepaid: number;
  /** 正なら納付、負なら還付 */
  taxDue: number;
  refund: number;
  estimatedResidentTax: number;
  estimatedBusinessTax: number;
  effectiveRatePct: number;
}

/**
 * 個人事業税の概算。法定業種に該当する場合、事業主控除290万円を控除して税率（多くは5%）を乗じる。
 * 業種により3〜5%かつ非課税業種もあるため、あくまで概算。
 */
export function calcBusinessTax(businessIncomeBeforeBlue: number, rate = 0.05): number {
  const base = Math.max(0, businessIncomeBeforeBlue - 2_900_000);
  return floor100(base * rate);
}

export function buildIncomeTaxReturn(
  pl: ProfitLoss,
  profile: BusinessProfile,
  options?: { residentTaxRate?: number; businessTaxRate?: number }
): IncomeTaxReturn {
  const d = profile.deductions;
  const other = profile.otherIncome;

  const businessRevenue = Math.round(pl.totalRevenue);
  const businessIncome = Math.max(0, Math.round(pl.netIncome));
  const salaryRevenue = Math.max(0, Number(other.salaryRevenue) || 0);
  const salaryIncome = Math.max(0, Number(other.salaryIncome) || 0);
  const miscIncome = Math.max(0, Number(other.miscIncome) || 0);

  const totalIncome = businessIncome + salaryIncome + miscIncome;

  const n = (v: number) => Math.max(0, Math.round(Number(v) || 0));
  const socialInsurance = n(d.socialInsurance);
  const smallBusinessMutualAid = n(d.smallBusinessMutualAid);
  const lifeInsurance = n(d.lifeInsurance);
  const earthquakeInsurance = n(d.earthquakeInsurance);
  const otherPersonal = n(d.otherPersonal);
  const spouse = n(d.spouse);
  const dependent = n(d.dependent);
  const basic = n(d.basic);
  const medical = n(d.medical);
  const donation = n(d.donation);

  const totalDeductions =
    socialInsurance +
    smallBusinessMutualAid +
    lifeInsurance +
    earthquakeInsurance +
    otherPersonal +
    spouse +
    dependent +
    basic +
    medical +
    donation;

  const taxableIncome = floor1000(Math.max(0, totalIncome - totalDeductions));
  const { tax: taxOnIncome } = calcIncomeTaxBase(taxableIncome);

  const taxCredit = n(d.taxCredit);
  const taxAfterCredit = Math.max(0, taxOnIncome - taxCredit);
  const reconstructionSurtax = Math.floor(taxAfterCredit * RECONSTRUCTION_SURTAX_RATE);
  const totalTax = floor100(taxAfterCredit + reconstructionSurtax);

  const withholdingTax = n(other.withholdingTax);
  const estimatedPrepaid = n(other.estimatedPrepaid);
  const settle = totalTax - withholdingTax - estimatedPrepaid;

  const residentRate = options?.residentTaxRate ?? 0.10;
  const estimatedResidentTax = floor100(Math.max(0, totalIncome - totalDeductions) * residentRate);
  const estimatedBusinessTax = calcBusinessTax(pl.incomeBeforeDeduction, options?.businessTaxRate ?? 0.05);

  return {
    businessRevenue,
    salaryRevenue,
    businessIncome,
    salaryIncome,
    miscIncome,
    totalIncome,
    socialInsurance,
    smallBusinessMutualAid,
    lifeInsurance,
    earthquakeInsurance,
    otherPersonal,
    spouse,
    dependent,
    basic,
    medical,
    donation,
    totalDeductions,
    taxableIncome,
    taxOnIncome,
    taxCredit,
    taxAfterCredit,
    reconstructionSurtax,
    totalTax,
    withholdingTax,
    estimatedPrepaid,
    taxDue: settle > 0 ? floor100(settle) : 0,
    refund: settle < 0 ? floor100(Math.abs(settle)) : 0,
    estimatedResidentTax,
    estimatedBusinessTax,
    effectiveRatePct: totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0,
  };
}
