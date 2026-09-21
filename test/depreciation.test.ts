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
});
