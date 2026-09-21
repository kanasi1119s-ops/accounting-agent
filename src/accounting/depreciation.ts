/**
 * 減価償却費の計算ロジック。「ソロAI帳簿」の src/accounting/depreciation.ts を移植。
 * 償却率表は国税庁「減価償却資産の償却率表」（平成19年4月1日以後取得分、定率法は200%定率法）に基づく。
 * 耐用年数2〜20年をカバー。実際の申告前に、国税庁の最新の公式表と照合してください。
 *
 * 【重要】減価償却の償却率は国税庁の公式な「耐用年数省令」の表に基づく必要があります。
 * 特に「定率法」の初年度の計算結果を1〜2件、国税庁の資料や他の会計ソフトの結果と突き合わせて検算することを強くおすすめします。
 */

export interface DepreciationRate {
  usefulLife: number;
  straightLineRate: number; // 定額法償却率
  decliningBalanceRate: number; // 定率法償却率
  revisedRate?: number; // 改定償却率
  guaranteeRate?: number; // 保証率
}

export const DEPRECIATION_RATE_TABLE: DepreciationRate[] = [
  { usefulLife: 2, straightLineRate: 0.5, decliningBalanceRate: 1.0 },
  { usefulLife: 3, straightLineRate: 0.334, decliningBalanceRate: 0.667, revisedRate: 1.0, guaranteeRate: 0.11089 },
  { usefulLife: 4, straightLineRate: 0.25, decliningBalanceRate: 0.5, revisedRate: 1.0, guaranteeRate: 0.12499 },
  { usefulLife: 5, straightLineRate: 0.2, decliningBalanceRate: 0.4, revisedRate: 0.5, guaranteeRate: 0.108 },
  { usefulLife: 6, straightLineRate: 0.167, decliningBalanceRate: 0.333, revisedRate: 0.334, guaranteeRate: 0.09911 },
  { usefulLife: 7, straightLineRate: 0.143, decliningBalanceRate: 0.286, revisedRate: 0.334, guaranteeRate: 0.0868 },
  { usefulLife: 8, straightLineRate: 0.125, decliningBalanceRate: 0.25, revisedRate: 0.334, guaranteeRate: 0.07909 },
  { usefulLife: 9, straightLineRate: 0.112, decliningBalanceRate: 0.222, revisedRate: 0.25, guaranteeRate: 0.07126 },
  { usefulLife: 10, straightLineRate: 0.1, decliningBalanceRate: 0.2, revisedRate: 0.25, guaranteeRate: 0.06552 },
  { usefulLife: 11, straightLineRate: 0.091, decliningBalanceRate: 0.182, revisedRate: 0.2, guaranteeRate: 0.05992 },
  { usefulLife: 12, straightLineRate: 0.084, decliningBalanceRate: 0.167, revisedRate: 0.2, guaranteeRate: 0.05566 },
  { usefulLife: 13, straightLineRate: 0.077, decliningBalanceRate: 0.154, revisedRate: 0.167, guaranteeRate: 0.0518 },
  { usefulLife: 14, straightLineRate: 0.072, decliningBalanceRate: 0.143, revisedRate: 0.167, guaranteeRate: 0.04854 },
  { usefulLife: 15, straightLineRate: 0.067, decliningBalanceRate: 0.133, revisedRate: 0.143, guaranteeRate: 0.04565 },
  { usefulLife: 16, straightLineRate: 0.063, decliningBalanceRate: 0.125, revisedRate: 0.143, guaranteeRate: 0.04294 },
  { usefulLife: 17, straightLineRate: 0.059, decliningBalanceRate: 0.118, revisedRate: 0.125, guaranteeRate: 0.04038 },
  { usefulLife: 18, straightLineRate: 0.056, decliningBalanceRate: 0.111, revisedRate: 0.112, guaranteeRate: 0.03884 },
  { usefulLife: 19, straightLineRate: 0.053, decliningBalanceRate: 0.105, revisedRate: 0.112, guaranteeRate: 0.03693 },
  { usefulLife: 20, straightLineRate: 0.05, decliningBalanceRate: 0.1, revisedRate: 0.112, guaranteeRate: 0.03217 },
];

export function getDepreciationRate(usefulLife: number): DepreciationRate | undefined {
  return DEPRECIATION_RATE_TABLE.find((r) => r.usefulLife === usefulLife);
}

export interface FixedAssetInput {
  acquisitionCost: number;
  acquisitionDate: string; // YYYY-MM-DD
  usefulLife: number;
  method: 'straight' | 'declining';
  businessRatio: number; // 0〜1
  priorAccumulatedDepreciation: number;
  disposedAt?: string | null; // YYYY-MM-DD（除却・売却日。null/未指定なら継続保有）
}

export interface DepreciationResult {
  annualDepreciation: number; // 普通償却費（事業割合適用前、月割り適用後）
  businessPortionDepreciation: number; // 事業割合適用後（帳簿に計上する額）
  accumulatedDepreciation: number;
  bookValueAtYearEnd: number; // 取得価額－累積償却額、備忘価額1円まで
  isFullyDepreciated: boolean;
}

const MEMORANDUM_VALUE = 1; // 備忘価額

/**
 * 指定した会計年度（fiscalYear、1〜12月の暦年）分の減価償却費を計算する。
 * 取得年の年度は、事業供用開始日から年度末までの月数で月割りする。除却年度は
 * 除却日を含む月までで月割りする。
 *
 * 定率法は、通常償却額が保証額を下回った年度以降、その切替年度の未償却残高×改定償却率を
 * 毎年据え置く必要がある（切替後に残高で再計算すると年々減少してしまい税法上誤りになる）。
 * この関数は priorAccumulatedDepreciation が「このソフトで管理する前の時点の累積償却額」で
 * あり年度ごとに自動繰越されないことを踏まえ、取得年度から対象年度まで1年ずつシミュレーションして
 * 切替タイミングと据置額を都度re-deriveする。
 */
export function calculateDepreciationForYear(asset: FixedAssetInput, fiscalYear: number): DepreciationResult {
  const rate = getDepreciationRate(asset.usefulLife);
  const zero: DepreciationResult = {
    annualDepreciation: 0,
    businessPortionDepreciation: 0,
    accumulatedDepreciation: asset.priorAccumulatedDepreciation,
    bookValueAtYearEnd: asset.acquisitionCost - asset.priorAccumulatedDepreciation,
    isFullyDepreciated: asset.priorAccumulatedDepreciation >= asset.acquisitionCost - MEMORANDUM_VALUE,
  };
  if (!rate) return zero;

  const acquisitionDate = new Date(asset.acquisitionDate);
  const acquisitionYear = acquisitionDate.getFullYear();
  if (acquisitionYear > fiscalYear) return zero;
  if (zero.isFullyDepreciated) return zero;

  const disposalDate = asset.disposedAt ? new Date(asset.disposedAt) : null;
  const disposalYear = disposalDate ? disposalDate.getFullYear() : null;
  if (disposalYear !== null && disposalYear < fiscalYear) return zero;

  let accumulated = asset.priorAccumulatedDepreciation;
  let frozenAmount: number | null = null; // 定率法：改定償却率切替後の据置年額（12ヶ月換算）
  let annualDepreciation = 0;

  for (let y = acquisitionYear; y <= fiscalYear; y++) {
    const remaining = asset.acquisitionCost - MEMORANDUM_VALUE - accumulated;
    if (remaining <= 0) {
      annualDepreciation = 0;
      break;
    }

    const startMonth = y === acquisitionYear ? acquisitionDate.getMonth() : 0;
    const endMonthExclusive = disposalYear === y ? (disposalDate as Date).getMonth() + 1 : 12;
    const monthsInService = Math.max(0, endMonthExclusive - startMonth);

    let rawAnnual: number;
    if (monthsInService === 0) {
      rawAnnual = 0;
    } else if (asset.method === 'straight') {
      rawAnnual = Math.round((asset.acquisitionCost * rate.straightLineRate * monthsInService) / 12);
    } else if (frozenAmount !== null) {
      rawAnnual = monthsInService < 12 ? Math.round((frozenAmount * monthsInService) / 12) : frozenAmount;
    } else {
      const bookValueAtYearStart = asset.acquisitionCost - accumulated;
      const guaranteeAmount = rate.guaranteeRate ? asset.acquisitionCost * rate.guaranteeRate : 0;
      const normalAmount = Math.round((bookValueAtYearStart * rate.decliningBalanceRate * monthsInService) / 12);

      if (rate.guaranteeRate && normalAmount < guaranteeAmount && rate.revisedRate) {
        frozenAmount = Math.round(bookValueAtYearStart * rate.revisedRate);
        rawAnnual = monthsInService < 12 ? Math.round((frozenAmount * monthsInService) / 12) : frozenAmount;
      } else {
        rawAnnual = normalAmount;
      }
    }

    annualDepreciation = Math.min(rawAnnual, remaining);
    accumulated += annualDepreciation;

    if (disposalYear === y) break;
  }

  const businessPortionDepreciation = Math.round(annualDepreciation * asset.businessRatio);

  return {
    annualDepreciation,
    businessPortionDepreciation,
    accumulatedDepreciation: accumulated,
    bookValueAtYearEnd: asset.acquisitionCost - accumulated,
    isFullyDepreciated: accumulated >= asset.acquisitionCost - MEMORANDUM_VALUE,
  };
}
