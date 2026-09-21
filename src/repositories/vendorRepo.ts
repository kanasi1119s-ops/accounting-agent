import { pool } from '../db/pool.js';
import type { VendorCategoryHistoryEntry } from '../accounting/categorySuggestion.js';

export interface Vendor {
  id: string;
  name: string;
  defaultCategory: string | null;
  invoiceRegistrationNumber: string | null;
  registrationStatus: 'registered' | 'exempt' | 'unknown';
}

export async function findVendorByName(name: string): Promise<Vendor | null> {
  const { rows } = await pool.query(
    `SELECT id, name, default_category, invoice_registration_number, registration_status
     FROM vendors WHERE name = $1`,
    [name]
  );
  if (rows.length === 0) return null;
  return mapVendor(rows[0]);
}

export async function findOrCreateVendorByName(name: string): Promise<Vendor> {
  const existing = await findVendorByName(name);
  if (existing) return existing;

  const { rows } = await pool.query(
    `INSERT INTO vendors (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, default_category, invoice_registration_number, registration_status`,
    [name]
  );
  return mapVendor(rows[0]);
}

export async function getVendorCategoryHistory(vendorId: string): Promise<VendorCategoryHistoryEntry[]> {
  const { rows } = await pool.query(
    `SELECT category, match_count FROM vendor_category_patterns WHERE vendor_id = $1`,
    [vendorId]
  );
  return rows.map((r) => ({ category: r.category, matchCount: r.match_count }));
}

/** 承認時に呼び出し、その取引先×勘定科目の組み合わせの学習データを積み増す */
export async function recordVendorCategoryMatch(vendorId: string, category: string): Promise<void> {
  await pool.query(
    `INSERT INTO vendor_category_patterns (vendor_id, category, match_count, last_matched_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (vendor_id, category)
     DO UPDATE SET match_count = vendor_category_patterns.match_count + 1, last_matched_at = now()`,
    [vendorId, category]
  );
}

function mapVendor(row: any): Vendor {
  return {
    id: row.id,
    name: row.name,
    defaultCategory: row.default_category,
    invoiceRegistrationNumber: row.invoice_registration_number,
    registrationStatus: row.registration_status,
  };
}
