-- 家事按分（プライベート利用分を除いた事業按分比率）ルールの設定機能。
-- 自動計算はせず、取引先ごとにユーザーが設定した比率を「案」として取込時に適用するだけに留める。

ALTER TABLE vendors
  ADD COLUMN default_business_ratio NUMERIC(4, 3)
    CHECK (default_business_ratio IS NULL OR (default_business_ratio >= 0 AND default_business_ratio <= 1));
COMMENT ON COLUMN vendors.default_business_ratio IS
  '按分ルール設定画面で登録する、この取引先のデフォルト事業按分比率（0-1）。未設定はNULL。';

ALTER TABLE invoices
  ADD COLUMN business_ratio NUMERIC(4, 3)
    CHECK (business_ratio IS NULL OR (business_ratio >= 0 AND business_ratio <= 1));
COMMENT ON COLUMN invoices.business_ratio IS
  'この取引の事業按分比率（0-1）。allocation_required=trueのとき、取引先のdefault_business_ratioがあれば案として複写する。NULLは「未設定＝100%として扱われているが要確認」を意味する。';
