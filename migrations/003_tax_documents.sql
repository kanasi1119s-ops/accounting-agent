-- 決算書類作成（青色申告決算書相当・消費税申告書・所得税試算・固定資産台帳）に必要なテーブル群。
-- 「ソロAI帳簿」の src/tax/{incomeTax,consumptionTax}.ts, src/accounting/depreciation.ts,
-- src/core/fixedAssets.ts, src/types.ts の BusinessProfile 相当を移植する。

-- ============================================================
-- business_profiles: 確定申告に必要な事業者プロフィール（年度ごとに1件）
-- 項目数が多いため、個々のカラムにはせずJSONBにまとめて保持する（settingsテーブルと同じ方針）。
-- ============================================================
CREATE TABLE business_profiles (
  fiscal_year INTEGER PRIMARY KEY,
  profile JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- fixed_assets: 固定資産台帳（減価償却費の計算に使用）
-- ============================================================
CREATE TABLE fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  acquisition_date DATE NOT NULL,
  acquisition_cost BIGINT NOT NULL CHECK (acquisition_cost >= 0),
  useful_life INTEGER NOT NULL CHECK (useful_life BETWEEN 2 AND 20),
  method TEXT NOT NULL CHECK (method IN ('straight', 'declining')),
  business_ratio NUMERIC(4, 3) NOT NULL DEFAULT 1 CHECK (business_ratio >= 0 AND business_ratio <= 1),
  -- このソフト導入前も含め、過去に計上済みの累積償却額（新規購入なら0）
  prior_accumulated_depreciation BIGINT NOT NULL DEFAULT 0,
  disposed_at DATE, -- 除却・売却した場合の日付（NULLなら保有中）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- invoices.tax_class: 消費税の課税区分。集計の正確性のため区分記載を保持する。
-- 大半の通常取引は 'taxable'。給与・租税公課・家事按分の非事業分などは 'outofscope'/'nontaxable'。
-- ============================================================
ALTER TABLE invoices
  ADD COLUMN tax_class TEXT NOT NULL DEFAULT 'taxable'
    CHECK (tax_class IN ('taxable', 'nontaxable', 'outofscope'));
COMMENT ON COLUMN invoices.tax_class IS
  '消費税申告書の集計対象区分。taxable=課税, nontaxable=非課税, outofscope=不課税（給与等）。';
