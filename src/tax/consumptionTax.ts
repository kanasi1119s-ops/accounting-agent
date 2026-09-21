/**
 * 消費税申告書の試算ロジック。「ソロAI帳簿」の src/tax/consumptionTax.ts を、
 * invoices テーブル（承認済みレコード）向けに書き換えて移植した。
 */
import type { BusinessProfile } from '../types/businessProfile.js';
import { businessTotal, isBalanceSheetCategory, type LedgerSourceInvoice } from '../accounting/journal.js';
import { floor100 } from './incomeTax.js';

/** 簡易課税のみなし仕入率 */
export const DEEMED_PURCHASE_RATES: Record<number, { label: string; rate: number }> = {
  1: { label: '第1種（卸売業）', rate: 0.90 },
  2: { label: '第2種（小売業・飲食料品の譲渡）', rate: 0.80 },
  3: { label: '第3種（製造業・建設業・農林漁業）', rate: 0.70 },
  4: { label: '第4種（飲食店業・その他）', rate: 0.60 },
  5: { label: '第5種（サービス業・運輸通信業・金融保険業）', rate: 0.50 },
  6: { label: '第6種（不動産業）', rate: 0.40 },
};

/** 国税と地方消費税の内訳（標準税率10% = 国税7.8% + 地方2.2%） */
export const NATIONAL_RATE_10 = 7.8 / 110;
export const NATIONAL_RATE_8 = 6.24 / 108;
export const LOCAL_RATIO = 22 / 78;

export interface ConsumptionTaxReturn {
  applicable: boolean;
  method: 'principle' | 'simplified' | 'special20';
  methodLabel: string;
  taxableSalesGross: number;
  taxBase: number;
  outputTax: number;
  inputTax: number;
  nationalTax: number;
  localTax: number;
  totalTax: number;
  interimPayment: number;
  taxDue: number;
  refund: number;
  deemedRate?: number;
  notes: string[];
}

export function buildConsumptionTaxReturn(
  invoices: LedgerSourceInvoice[],
  profile: BusinessProfile
): ConsumptionTaxReturn {
  const c = profile.consumptionTax;
  const notes: string[] = [];

  if (!c.isTaxable) {
    return {
      applicable: false,
      method: c.method,
      methodLabel: '免税事業者',
      taxableSalesGross: 0,
      taxBase: 0,
      outputTax: 0,
      inputTax: 0,
      nationalTax: 0,
      localTax: 0,
      totalTax: 0,
      interimPayment: 0,
      taxDue: 0,
      refund: 0,
      notes: ['免税事業者のため消費税申告書は作成されません。設定で課税事業者に切り替えられます。'],
    };
  }

  const plInvoices = invoices.filter((inv) => !isBalanceSheetCategory(inv.category));

  const sales = plInvoices.filter((t) => t.direction === 'income' && t.taxClass !== 'outofscope');
  const sales10 = sales.filter((t) => (t.taxRate ?? 0.1) >= 0.095);
  const sales8 = sales.filter((t) => (t.taxRate ?? 0.1) > 0 && (t.taxRate ?? 0.1) < 0.095);

  const gross10 = sales10.reduce((a, t) => a + businessTotal(t), 0);
  const gross8 = sales8.reduce((a, t) => a + businessTotal(t), 0);
  const taxableSalesGross = gross10 + gross8;

  const base10 = Math.floor((gross10 * 100) / 110);
  const base8 = Math.floor((gross8 * 100) / 108);
  const taxBase = Math.floor((base10 + base8) / 1000) * 1000;

  const outputTax = Math.floor(gross10 * NATIONAL_RATE_10 + gross8 * NATIONAL_RATE_8);

  let inputTax = 0;
  let deemedRate: number | undefined;

  if (c.method === 'simplified') {
    deemedRate = DEEMED_PURCHASE_RATES[c.simplifiedBusinessType]?.rate ?? 0.5;
    inputTax = Math.floor(outputTax * deemedRate);
    notes.push(
      `簡易課税：${DEEMED_PURCHASE_RATES[c.simplifiedBusinessType]?.label ?? ''}／みなし仕入率 ${Math.round(deemedRate * 100)}%`
    );
  } else if (c.method === 'special20') {
    deemedRate = 0.8;
    inputTax = Math.floor(outputTax * 0.8);
    notes.push('2割特例：納付税額を課税売上に係る消費税額の2割として計算しています。適用要件は必ず確認してください。');
  } else {
    const purchases = plInvoices.filter(
      (t) => t.direction === 'expense' && t.taxClass !== 'outofscope' && t.taxClass !== 'nontaxable'
    );
    const p10 = purchases.filter((t) => (t.taxRate ?? 0.1) >= 0.095).reduce((a, t) => a + businessTotal(t), 0);
    const p8 = purchases
      .filter((t) => (t.taxRate ?? 0.1) > 0 && (t.taxRate ?? 0.1) < 0.095)
      .reduce((a, t) => a + businessTotal(t), 0);
    inputTax = Math.floor(p10 * NATIONAL_RATE_10 + p8 * NATIONAL_RATE_8);
    notes.push('本則課税：全額控除（課税売上割合95%以上）を前提に計算しています。');
    const noInvoice = purchases.filter((t) => !t.invoiceRegistrationNumber).length;
    if (noInvoice > 0) {
      notes.push(`登録番号が未入力の課税仕入れが ${noInvoice} 件あります。本則課税では仕入税額控除に適格請求書が必要です。`);
    }
  }

  const nationalTax = floor100(Math.max(0, outputTax - inputTax));
  const localTax = floor100(nationalTax * LOCAL_RATIO);
  const totalTax = nationalTax + localTax;
  const interimPayment = Math.max(0, Number(c.interimPayment) || 0);
  const settle = totalTax - interimPayment;

  return {
    applicable: true,
    method: c.method,
    methodLabel: c.method === 'principle' ? '本則課税' : c.method === 'simplified' ? '簡易課税' : '2割特例',
    taxableSalesGross,
    taxBase,
    outputTax,
    inputTax,
    nationalTax,
    localTax,
    totalTax,
    interimPayment,
    taxDue: settle > 0 ? floor100(settle) : 0,
    refund: settle < 0 ? floor100(Math.abs(settle)) : 0,
    deemedRate,
    notes,
  };
}
