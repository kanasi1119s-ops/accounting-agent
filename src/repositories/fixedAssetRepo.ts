import { pool } from '../db/pool.js';

export interface FixedAsset {
  id: string;
  name: string;
  acquisitionDate: string; // YYYY-MM-DD
  acquisitionCost: number;
  usefulLife: number;
  method: 'straight' | 'declining';
  businessRatio: number;
  priorAccumulatedDepreciation: number;
  disposedAt: string | null;
}

export interface NewFixedAsset {
  name: string;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLife: number;
  method: 'straight' | 'declining';
  businessRatio: number;
  priorAccumulatedDepreciation: number;
}

function mapRow(row: any): FixedAsset {
  return {
    id: row.id,
    name: row.name,
    acquisitionDate: row.acquisition_date,
    acquisitionCost: Number(row.acquisition_cost),
    usefulLife: row.useful_life,
    method: row.method,
    businessRatio: Number(row.business_ratio),
    priorAccumulatedDepreciation: Number(row.prior_accumulated_depreciation),
    disposedAt: row.disposed_at,
  };
}

export async function listFixedAssets(): Promise<FixedAsset[]> {
  const { rows } = await pool.query('SELECT * FROM fixed_assets ORDER BY acquisition_date, created_at');
  return rows.map(mapRow);
}

export async function createFixedAsset(input: NewFixedAsset): Promise<FixedAsset> {
  const { rows } = await pool.query(
    `INSERT INTO fixed_assets (name, acquisition_date, acquisition_cost, useful_life, method, business_ratio, prior_accumulated_depreciation)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      input.name,
      input.acquisitionDate,
      input.acquisitionCost,
      input.usefulLife,
      input.method,
      input.businessRatio,
      input.priorAccumulatedDepreciation,
    ]
  );
  return mapRow(rows[0]);
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  name: 'name',
  acquisitionDate: 'acquisition_date',
  acquisitionCost: 'acquisition_cost',
  usefulLife: 'useful_life',
  method: 'method',
  businessRatio: 'business_ratio',
  priorAccumulatedDepreciation: 'prior_accumulated_depreciation',
  disposedAt: 'disposed_at',
};

export async function updateFixedAsset(id: string, fields: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(fields).filter((k) => k in UPDATABLE_COLUMNS);
  if (keys.length === 0) return;
  const setClauses = keys.map((k, i) => `${UPDATABLE_COLUMNS[k]} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE fixed_assets SET ${setClauses}, updated_at = now() WHERE id = $1`, [
    id,
    ...keys.map((k) => fields[k]),
  ]);
}

export async function deleteFixedAsset(id: string): Promise<void> {
  await pool.query('DELETE FROM fixed_assets WHERE id = $1', [id]);
}
