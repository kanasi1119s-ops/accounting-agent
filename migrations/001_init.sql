-- 初期スキーマ: 請求書/レシート、取引先、承認キュー、監査ログ、設定
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- vendors: 取引先マスタ
-- ============================================================
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  default_category TEXT,
  invoice_registration_number TEXT,
  registration_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (registration_status IN ('registered', 'exempt', 'unknown')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vendors_name_key ON vendors (name);

-- 取引先ごとの勘定科目 紐付け履歴（信頼度スコア付き自動提案の学習データ）
CREATE TABLE vendor_category_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  match_count INTEGER NOT NULL DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, category)
);
CREATE INDEX vendor_category_patterns_vendor_id_idx ON vendor_category_patterns (vendor_id);

-- ============================================================
-- invoices: 請求書・レシート・通帳明細等の証憑1件ごとのレコード
-- ============================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id),
  vendor_name_raw TEXT, -- OCR/入力が読み取ったままの取引先名（vendor未確定の場合に使用）

  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  document_type TEXT NOT NULL DEFAULT 'other'
    CHECK (document_type IN ('receipt', 'invoice', 'statement', 'email', 'other')),

  issue_date DATE,
  amount_excl_tax BIGINT,
  tax_amount BIGINT,
  amount_incl_tax BIGINT,
  tax_rate NUMERIC(5, 4),

  currency TEXT NOT NULL DEFAULT 'JPY',
  fx_rate NUMERIC(18, 6),
  fx_rate_date DATE,
  fx_method TEXT CHECK (fx_method IN ('ttm', 'tts', 'ttb')),

  invoice_registration_number TEXT,
  invoice_number_valid BOOLEAN,
  vendor_registration_status_at_txn TEXT
    CHECK (vendor_registration_status_at_txn IN ('registered', 'unregistered', 'unknown')),
  deemed_deduction_rate NUMERIC(4, 3), -- 経過措置による仕入税額控除率 (0.8 / 0.5 / 0)

  items JSONB NOT NULL DEFAULT '[]',

  source_file_path TEXT,
  source_file_hash TEXT,
  dedup_hash TEXT, -- 発行日+取引先+金額のハッシュ（重複検知用）
  duplicate_of_invoice_id UUID REFERENCES invoices(id),

  extraction_method TEXT NOT NULL DEFAULT 'unextractable'
    CHECK (extraction_method IN ('pdf_text', 'ocr_image', 'manual', 'unextractable')),
  ocr_raw_json JSONB,
  ocr_confidence NUMERIC(4, 3),

  tax_consistency_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (tax_consistency_status IN ('ok', 'mismatch', 'unverified')),

  category TEXT,
  category_confidence NUMERIC(5, 2),
  category_source TEXT CHECK (category_source IN ('vendor_history', 'keyword_guess', 'rule', 'manual')),
  allocation_required BOOLEAN NOT NULL DEFAULT false,

  multi_page_total_mismatch BOOLEAN NOT NULL DEFAULT false,
  page_count INTEGER,

  description TEXT,
  payment_method TEXT,

  status TEXT NOT NULL DEFAULT 'pending_extraction' CHECK (status IN (
    'pending_extraction',  -- 取込直後、抽出前
    'pending_review',      -- 抽出済み、承認待ち
    'needs_manual_input',  -- 自動抽出不可、手動入力待ち
    'approved',
    'rejected',
    'duplicate_flagged'
  )),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoices_vendor_id_idx ON invoices (vendor_id);
CREATE INDEX invoices_status_idx ON invoices (status);
CREATE INDEX invoices_dedup_hash_idx ON invoices (dedup_hash);
CREATE INDEX invoices_issue_date_idx ON invoices (issue_date);

-- ============================================================
-- approval_queue: 人間の承認待ちキュー
-- ============================================================
CREATE TABLE approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reasons TEXT[] NOT NULL DEFAULT '{}', -- amount_threshold / low_confidence / invoice_requirement / multi_page_mismatch / duplicate / phase1_all
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'needs_info')),
  approver TEXT,
  decided_at TIMESTAMPTZ,
  decision_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX approval_queue_invoice_id_idx ON approval_queue (invoice_id);
CREATE INDEX approval_queue_status_idx ON approval_queue (status);

-- ============================================================
-- audit_log: 変更前後の値・変更者・変更理由（差し戻し理由の学習データ蓄積を兼ねる）
-- ============================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- create / update / approve / reject / reassign_category / mark_duplicate 等
  field_name TEXT,
  old_value JSONB,
  new_value JSONB,
  changed_by TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_invoice_id_idx ON audit_log (invoice_id);
CREATE INDEX audit_log_action_idx ON audit_log (action);

-- ============================================================
-- settings: 信頼度閾値・金額閾値など、コードに埋め込まず外出しする設定値
-- ============================================================
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO settings (key, value, description) VALUES
  ('category_confidence_threshold', '70',
    '勘定科目自動提案の信頼度しきい値（0-100）。フェーズ2でこれ以上を高信頼度提案として扱う。'),
  ('auto_approval_amount_threshold', '10000',
    'この金額（円・税込）以上は信頼度に関わらず必ず人間承認が必要。'),
  ('auto_approval_enabled', 'false',
    'フェーズ2切り替えスイッチ: true で高信頼度案件のワンクリック承認UIを有効化する。'),
  ('full_auto_enabled', 'false',
    'フェーズ3切り替えスイッチ: true で閾値未満の完全自動仕訳を有効化する。運用実績を見て判断する。');
