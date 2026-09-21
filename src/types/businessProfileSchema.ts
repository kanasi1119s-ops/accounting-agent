/**
 * BusinessProfile の入力検証用zodスキーマ。
 * PUT /api/business-profile/:year が任意のJSONを無検証で保存していた問題への対応。
 * 数値フィールドは全体的に「未入力(undefined)なら0扱い」を許容しつつ、型・範囲・enum値は厳格にする。
 */
import { z } from 'zod';

const numOrDefault = (def: number) => z.number().finite().default(def);

export const consumptionTaxProfileSchema = z.object({
  isTaxable: z.boolean().default(false),
  method: z.enum(['principle', 'simplified', 'special20']).default('principle'),
  simplifiedBusinessType: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).default(5),
  accounting: z.enum(['tax_included', 'tax_excluded']).default('tax_included'),
  interimPayment: numOrDefault(0),
});

export const deductionInputSchema = z.object({
  socialInsurance: numOrDefault(0),
  smallBusinessMutualAid: numOrDefault(0),
  lifeInsurance: numOrDefault(0),
  earthquakeInsurance: numOrDefault(0),
  medical: numOrDefault(0),
  donation: numOrDefault(0),
  spouse: numOrDefault(0),
  dependent: numOrDefault(0),
  basic: numOrDefault(480000),
  otherPersonal: numOrDefault(0),
  taxCredit: numOrDefault(0),
});

export const openingBalancesSchema = z.object({
  現金: numOrDefault(0),
  普通預金: numOrDefault(0),
  売掛金: numOrDefault(0),
  棚卸資産: numOrDefault(0),
  固定資産: numOrDefault(0),
  その他資産: numOrDefault(0),
  買掛金: numOrDefault(0),
  未払金: numOrDefault(0),
  借入金: numOrDefault(0),
  その他負債: numOrDefault(0),
  元入金: z.number().finite().optional(),
});

export const otherIncomeInputSchema = z.object({
  salaryRevenue: numOrDefault(0),
  salaryIncome: numOrDefault(0),
  miscIncome: numOrDefault(0),
  withholdingTax: numOrDefault(0),
  estimatedPrepaid: numOrDefault(0),
});

export const businessProfileSchema = z.object({
  fiscalYear: z.number().int(),
  name: z.string().default(''),
  nameKana: z.string().default(''),
  tradeName: z.string().default(''),
  postalCode: z.string().default(''),
  address: z.string().default(''),
  addressJan1: z.string().optional(),
  phone: z.string().default(''),
  occupation: z.string().default(''),
  businessDescription: z.string().default(''),
  taxOffice: z.string().default(''),
  filingType: z.enum(['blue', 'white']).default('blue'),
  blueDeduction: z.union([z.literal(650000), z.literal(550000), z.literal(100000), z.literal(0)]).default(650000),
  useEtax: z.boolean().default(true),
  invoiceRegNumber: z.string().default(''),
  startDate: z.string().default(''),
  hasFamilyEmployee: z.boolean().default(false),
  familyEmployeeSalary: numOrDefault(0),
  consumptionTax: consumptionTaxProfileSchema.default({}),
  deductions: deductionInputSchema.default({}),
  openingBalances: openingBalancesSchema.default({}),
  closingInventory: numOrDefault(0),
  otherIncome: otherIncomeInputSchema.default({}),
});
