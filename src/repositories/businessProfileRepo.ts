import { pool } from '../db/pool.js';
import { type BusinessProfile, defaultBusinessProfile } from '../types/businessProfile.js';

export async function getBusinessProfile(fiscalYear: number): Promise<BusinessProfile> {
  const { rows } = await pool.query('SELECT profile FROM business_profiles WHERE fiscal_year = $1', [fiscalYear]);
  const defaults = defaultBusinessProfile(fiscalYear);
  if (rows.length === 0) return defaults;

  // 保存済みプロフィールにデフォルト値をマージする。ネストしたオブジェクト（consumptionTax等）は
  // フィールド単位でマージし、保存済みデータが一部フィールドしか持っていない場合でも
  // 他のデフォルト値（基礎控除48万円など）が消えないようにする。
  // 通常はPUT側のzodスキーマが常に完全な形で保存するが、スキーマ導入前に保存された
  // 古いデータに対する防御でもある。
  const stored = rows[0].profile as Partial<BusinessProfile>;
  return {
    ...defaults,
    ...stored,
    fiscalYear,
    consumptionTax: { ...defaults.consumptionTax, ...stored.consumptionTax },
    deductions: { ...defaults.deductions, ...stored.deductions },
    openingBalances: { ...defaults.openingBalances, ...stored.openingBalances },
    otherIncome: { ...defaults.otherIncome, ...stored.otherIncome },
  };
}

export async function saveBusinessProfile(fiscalYear: number, profile: BusinessProfile): Promise<void> {
  await pool.query(
    `INSERT INTO business_profiles (fiscal_year, profile)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (fiscal_year) DO UPDATE SET profile = $2::jsonb, updated_at = now()`,
    [fiscalYear, JSON.stringify(profile)]
  );
}
