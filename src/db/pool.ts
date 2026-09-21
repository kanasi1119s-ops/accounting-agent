import pg from 'pg';

const { Pool, types } = pg;

// DATE型(oid 1082)をJSのDateオブジェクトに変換させない。
// pgのデフォルト実装は年月日をローカルタイムゾーンの深夜として組み立てるため、
// JST環境ではUTCに変換される際に日付が1日ずれる。"YYYY-MM-DD"の文字列のまま扱う。
types.setTypeParser(1082, (value: string) => value);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL が設定されていません。.env を確認してください。');
}

// Render/Fly等のマネージドPostgresはSSL接続を要求する。ローカル開発用クラスタ（localhost）はSSL不要。
const requiresSsl = !/localhost|127\.0\.0\.1/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
});
