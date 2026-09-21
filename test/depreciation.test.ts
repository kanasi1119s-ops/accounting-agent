import { describe, expect, it } from 'vitest';
import { calculateDepreciationForYear } from '../src/accounting/depreciation.js';

describe('calculateDepreciationForYear', () => {
  it('computes straight-line depreciation for a full year', () => {
    // 耐用年数4年、定額法償却率0.25、取得価額400,000円 -> 年100,000円
    const result = calculateDepreciationForYear(
      {
        acquisitionCost: 400_000,
        acquisitionDate: '2024-01-01',
        usefulLife: 4,
        method: 'straight',
        businessRatio: 1,
        priorAccumulatedDepreciation: 0,
      },
      2026
    );
    expect(result.annualDepreciation).toBe(100_000);
    expect(result.isFullyDepreciated).toBe(false);
  });

  it('prorates the acquisition year by month', () => {
    // 7月取得（6ヶ月分） 400,000円 x 0.25 x 6/12 = 50,000円
    const result = calculateDepreciationForYear(
      {
        acquisitionCost: 400_000,
        acquisitionDate: '2026-07-01',
        usefulLife: 4,
        method: 'straight',
        businessRatio: 1,
        priorAccumulatedDepreciation: 0,
      },
      2026
    );
    expect(result.annualDepreciation).toBe(50_000);
  });

  it('applies the business-use ratio to the booked portion only', () => {
    const result = calculateDepreciationForYear(
      {
        acquisitionCost: 400_000,
        acquisitionDate: '2024-01-01',
        usefulLife: 4,
        method: 'straight',
        businessRatio: 0.5,
        priorAccumulatedDepreciation: 0,
      },
      2026
    );
    expect(result.annualDepreciation).toBe(100_000);
    expect(result.businessPortionDepreciation).toBe(50_000);
  });

  it('stops at the memorandum value of 1 yen once fully depreciated', () => {
    const result = calculateDepreciationForYear(
      {
        acquisitionCost: 400_000,
        acquisitionDate: '2020-01-01',
        usefulLife: 4,
        method: 'straight',
        businessRatio: 1,
        priorAccumulatedDepreciation: 399_999,
      },
      2026
    );
    expect(result.annualDepreciation).toBe(0);
    expect(result.isFullyDepreciated).toBe(true);
    expect(result.bookValueAtYearEnd).toBe(1);
  });

  it('returns zero for an asset acquired after the requested fiscal year', () => {
    const result = calculateDepreciationForYear(
      {
        acquisitionCost: 400_000,
        acquisitionDate: '2027-01-01',
        usefulLife: 4,
        method: 'straight',
        businessRatio: 1,
        priorAccumulatedDepreciation: 0,
      },
      2026
    );
    expect(result.annualDepreciation).toBe(0);
  });

  it('freezes the declining-balance amount at the switch-year value instead of recomputing from a shrinking book value', () => {
    const asset = {
      acquisitionCost: 10_000_000,
      acquisitionDate: '2020-01-01',
      usefulLife: 10,
      method: 'declining' as const,
      businessRatio: 1,
      priorAccumulatedDepreciation: 0,
    };
    // 耐用年数10年の定率法：2026年度（取得7年目）に保証率を下回り改定償却率へ切替わる
    const switchYear = calculateDepreciationForYear(asset, 2026);
    const yearAfter = calculateDepreciationForYear(asset, 2027);
    const twoYearsAfter = calculateDepreciationForYear(asset, 2028);
    expect(switchYear.annualDepreciation).toBe(655_360);
    // 切替後は毎年同じ額で据え置かれる（帳簿価額で再計算すると年々減少してしまい税法上誤りになる）
    expect(yearAfter.annualDepreciation).toBe(655_360);
    expect(twoYearsAfter.annualDepreciation).toBe(655_360);
  });

  it('prorates the disposal-year depreciation by month and stops depreciating afterward', () => {
    const asset = {
      acquisitionCost: 400_000,
      acquisitionDate: '2024-01-01',
      usefulLife: 4,
      method: 'straight' as const,
      businessRatio: 1,
      priorAccumulatedDepreciation: 0,
      disposedAt: '2026-06-15',
    };
    const disposalYear = calculateDepreciationForYear(asset, 2026);
    // 年100,000円のうち1月〜6月（6ヶ月）分のみ計上
    expect(disposalYear.annualDepreciation).toBe(50_000);

    const afterDisposal = calculateDepreciationForYear(asset, 2027);
    expect(afterDisposal.annualDepreciation).toBe(0);
  });
});
