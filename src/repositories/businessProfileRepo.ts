import { pool } from '../db/pool.js';
import { type BusinessProfile, defaultBusinessProfile } from '../types/businessProfile.js';

export async function getBusinessProfile(fiscalYear: number): Promise<BusinessProfile> {
  const { rows } = await pool.query('SELECT profile FROM business_profiles WHERE fiscal_year = $1', [fiscalYear]);
  if (rows.length === 0) return defaultBusinessProfile(fiscalYear);
  // 保存済みプロフィールにデフォルト値をマージする（後からフィールドを追加してもUIが壊れないように）
  return { ...defaultBusinessProfile(fiscalYear), ...rows[0].profile, fiscalYear };
}

export async function saveBusinessProfile(fiscalYear: number, profile: BusinessProfile): Promise<void> {
  await pool.query(
    `INSERT INTO business_profiles (fiscal_year, profile)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (fiscal_year) DO UPDATE SET profile = $2::jsonb, updated_at = now()`,
    [fiscalYear, JSON.stringify(profile)]
  );
}
