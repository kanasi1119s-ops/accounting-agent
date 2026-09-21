/**
 * 税率計算・税抜税込の整合性チェック。
 *
 * 「ソロAI帳簿」の server.ts (/api/receipt-ocr) にあった、AIが返した税抜金額(amount)を
 * 無条件に信用せず total - tax との差が±1円以内のときだけ採用する、という考え方を移植し、
 * 「不一致は自動修正せず保留する」という今回の要件に合わせて判定結果を返す形に書き換えた。
 */

export type TaxConsistencyStatus = 'ok' | 'mismatch' | 'unverified';

export interface TaxConsistencyInput {
  /** 税抜金額。未取得なら null */
  amountExclTax: number | null;
  /** 消費税額。未取得なら null */
  taxAmount: number | null;
  /** 税込金額。未取得なら null */
  amountInclTax: number | null;
  /** 適用税率 (0.10 / 0.08 等)。未取得なら null */
  taxRate: number | null;
  /** 端数処理の丸め誤差として許容する円単位の差 */
  toleranceYen?: number;
}

export interface TaxConsistencyResult {
  status: TaxConsistencyStatus;
  /** 税率から逆算した理論上の税抜金額（参考値。自動修正はしない） */
  expectedAmountExclTax: number | null;
  /** 税率から逆算した理論上の税額（参考値。自動修正はしない） */
  expectedTaxAmount: number | null;
  /** amountExclTax + taxAmount と amountInclTax の差（円） */
  discrepancyYen: number | null;
  notes: string[];
}

/**
 * 税抜金額 × 税率 = 税込金額 の整合性を検証する。
 * 3項目（税抜・税額・税込）が全部揃っていなくても、揃っている範囲で検証する。
 * 不一致でもここでは値を書き換えない（呼び出し側が承認キューに保留する前提）。
 */
export function checkTaxConsistency(input: TaxConsistencyInput): TaxConsistencyResult {
  const tolerance = input.toleranceYen ?? 1;
  const notes: string[] = [];

  const { amountExclTax, taxAmount, amountInclTax, taxRate } = input;

  if (amountInclTax === null || (amountExclTax === null && taxAmount === null)) {
    notes.push('税抜・税込・消費税額のいずれかが不足しており、整合性を検証できません。');
    return {
      status: 'unverified',
      expectedAmountExclTax: null,
      expectedTaxAmount: null,
      discrepancyYen: null,
      notes,
    };
  }

  // 税率から理論値を計算する（参考値。自動修正には使わない）
  let expectedAmountExclTax: number | null = null;
  let expectedTaxAmount: number | null = null;
  if (taxRate !== null && taxRate > 0) {
    expectedAmountExclTax = Math.round(amountInclTax - amountInclTax / (1 + taxRate));
    expectedTaxAmount = amountInclTax - expectedAmountExclTax;
  }

  const resolvedAmountExclTax = amountExclTax ?? (taxAmount !== null ? amountInclTax - taxAmount : null);
  const resolvedTaxAmount = taxAmount ?? (amountExclTax !== null ? amountInclTax - amountExclTax : null);

  if (resolvedAmountExclTax === null || resolvedTaxAmount === null) {
    notes.push('税抜・消費税額のいずれも取得できていないため整合性を検証できません。');
    return {
      status: 'unverified',
      expectedAmountExclTax,
      expectedTaxAmount,
      discrepancyYen: null,
      notes,
    };
  }

  const discrepancyYen = resolvedAmountExclTax + resolvedTaxAmount - amountInclTax;

  if (Math.abs(discrepancyYen) > tolerance) {
    notes.push(
      `税抜金額(${resolvedAmountExclTax}円) + 消費税額(${resolvedTaxAmount}円) が税込金額(${amountInclTax}円) と一致しません（差額 ${discrepancyYen}円）。自動修正せず保留します。`
    );
    return { status: 'mismatch', expectedAmountExclTax, expectedTaxAmount, discrepancyYen, notes };
  }

  return { status: 'ok', expectedAmountExclTax, expectedTaxAmount, discrepancyYen, notes };
}
