import { pool } from '../db/pool.js';

/**
 * 信頼度閾値・金額閾値などの調整可能な設定値。
 * コードに埋め込まず settings テーブルから読む。DBに未登録のキーはデフォルト値を返す。
 */
const DEFAULTS: Record<string, unknown> = {
  category_confidence_threshold: 70,
  auto_approval_amount_threshold: 10000,
  auto_approval_enabled: false,
  full_auto_enabled: false,
};

export async function getSetting<T = unknown>(key: string): Promise<T> {
  const { rows } = await pool.query<{ value: unknown }>('SELECT value FROM settings WHERE key = $1', [key]);
  if (rows.length === 0) {
    if (key in DEFAULTS) return DEFAULTS[key] as T;
    throw new Error(`未知の設定キーです: ${key}`);
  }
  return rows[0].value as T;
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ key: string; value: unknown; description: string | null }>(
    'SELECT key, value, description FROM settings ORDER BY key'
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function updateSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `UPDATE settings SET value = $2::jsonb, updated_at = now() WHERE key = $1`,
    [key, JSON.stringify(value)]
  );
}
