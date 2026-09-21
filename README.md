# accounting-agent

個人事業主/中小企業向けの経理・請求書処理を行う自律型AIエージェント（サーバーサイド版）。

「ソロAI帳簿」（完全ローカル動作の配布用ソフト）とは別プロジェクトとして、外部API連携ありのサーバーサイドで構築している。最初の実運用先は個人整体院「旭身体LABO」の経理記帳。

## 段階的リリース方針

- **フェーズ1（現在）**: OCR抽出 → 検証 → 仕訳提案までは自動化するが、**自動仕訳・自動承認は一切行わない**。すべて `approval_queue` に入り、人間の確認・承認を待つ。
- **フェーズ2**: `settings.auto_approval_enabled` を有効化すると、信頼度が高い（`category_confidence_threshold` 以上）案件だけワンクリック承認の対象にできる想定（現在の `public/index.html` は信頼度に関わらず一律で人間の承認ボタンを要求する作りなので、UI側の一括承認導線は未実装）。
- **フェーズ3**: `settings.full_auto_enabled` を有効化すると、閾値未満の完全自動仕訳が視野に入る。旭身体LABOでの運用実績を見てから判断する。

## セットアップ

```bash
cp .env.example .env
# DATABASE_URL, GEMINI_API_KEY を設定
npm install
npm run migrate   # migrations/ 配下のSQLを順番に適用
npm run dev
```

起動後 `http://localhost:3000/` で承認キュー画面が開く（`npm run dev` はAPIとUIを同じポートで配信する）。

### ローカル動作確認用に作成した使い捨てPostgresクラスタ

システムのPostgreSQL 18サービス（Windowsサービス、パスワード不明）とは別に、動作確認のためだけの専用クラスタを作成済み:

- データディレクトリ: `C:\Users\fujik\accounting-agent-pgdata`
- ポート: `5433`（システム標準の5432とは別）
- 認証: `--auth=trust`（パスワード不要）— **ローカル専用の使い捨て設定。外部公開・本番には絶対に使わないこと**
- `.env` の `DATABASE_URL=postgres://postgres@localhost:5433/accounting_agent` はこのクラスタを指している

起動・停止:
```bash
# 起動
"C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" start -D "C:\Users\fujik\accounting-agent-pgdata" -o "-p 5433" -l "C:\Users\fujik\accounting-agent-pgdata\server.log"
# 停止
"C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" stop -D "C:\Users\fujik\accounting-agent-pgdata"
```

本番（Render/Fly.io）は別途マネージドPostgresを使うため、このクラスタは動作確認専用。不要になれば `accounting-agent-pgdata` フォルダごと削除してよい。

## 主要なディレクトリ

- `migrations/` — プレーンSQLのマイグレーションファイル。`src/db/migrate.ts` が `schema_migrations` テーブルで適用済みを管理し、未適用分だけを順番に実行する。
- `src/lib/` — OCRやDBに依存しない純粋ロジック（インボイス番号形式チェック、税抜税込整合性チェック、重複検知ハッシュ）。
- `src/ocr/` — Gemini Vision呼び出し（画像・スキャンPDF用）と、テキスト埋め込み型PDFの直接テキスト抽出。
- `src/accounting/` — 勘定科目マスタ、仕訳・決算集計ロジック（損益計算書・貸借対照表）、取引先履歴ベースの科目自動提案、固定資産減価償却。
- `src/tax/` — 消費税申告書・所得税（確定申告）の試算ロジック（DB非依存の純粋関数）。
- `src/types/businessProfile.ts` — 確定申告に必要な事業者プロフィールの型・デフォルト値。
- `src/pipeline/ingestInvoice.ts` — OCR取込 → 検証 → 仕訳提案 → 承認キュー投入までを一気通貫で行うオーケストレーター。
- `src/routes/` — Express APIルート（アップロード、承認、設定、レポート、事業者プロフィール、固定資産）。
- `src/repositories/` — DBアクセス層。
- `public/` — ビルド不要のvanilla HTML/JS画面。`index.html` が承認キュー一覧・取込、`invoice.html` が証憑1件の詳細・手動修正・外貨レート指定、`vendors.html` が按分ルール設定、`profile.html` が事業者プロフィール設定、`fixed-assets.html` が固定資産台帳、`reports.html` が決算書類（損益計算書・貸借対照表・消費税申告書・所得税試算・CSVエクスポート）。

## パイプラインの処理分岐

| 入力 | extraction_method | 処理 |
|---|---|---|
| PDF（テキスト埋め込み型） | `pdf_text` | `pdf-parse` で全文抽出 → Geminiでテキストから構造化（Vision不要） |
| PDF（スキャン画像型） | `ocr_image` | PDFバイト列をそのままGemini Visionに渡してOCR |
| 画像 (JPEG/PNG等) | `ocr_image` | Gemini VisionでOCR |
| メール本文（金額のみ・明細なし） | `unextractable` | 抽出せず `needs_manual_input` にフラグを立てる |
| 複数ページPDF | — | ページごとの小計を合算し、書類全体の合計と突き合わせ。不一致は `multi_page_total_mismatch` フラグ（ヒューリスティックのため検出できない場合は静かにスキップし、必ず目視確認に回す） |

検証は「不一致を自動修正しない」ことを徹底している:
- 税抜×税率=税込の不一致 → `tax_consistency_status = 'mismatch'` のまま保留
- インボイス番号の形式不正・未登録事業者 → 経過措置控除率（80%/50%/0%）を算出するだけで、税額は書き換えない
- 重複請求書検知（発行日+取引先+金額のハッシュ）→ `duplicate_flagged` として承認キューに乗せる（自動棄却はしない）

## 按分ルール設定（家事按分）

水道光熱費・通信費・地代家賃・車両費・旅費交通費など、事業とプライベートの按分が必要になりやすい科目（`src/accounting/accounts.ts` の `ALLOCATION_PRONE_CATEGORIES`）に該当する取引を取り込むと `allocation_required = true` になり、承認キューに `allocation_required` 理由が付く。

- 按分の**自動計算はしない**。[/vendors.html](public/vendors.html) で取引先ごとにデフォルトの事業按分比率（0-100%）を設定でき、次回以降その取引先の証憑を取り込んだときに「案」として `invoices.business_ratio` に複写されるだけ
- 未設定の場合は `business_ratio = null`（=100%として扱われるが要確認）のまま承認キューに乗るので、承認前に [invoice.html](public/invoice.html) の詳細画面から個別に比率を修正できる
- 決算集計（`src/accounting/journal.ts` の `businessTotal()`）は `status = 'approved'` の証憑についてのみ、この比率を金額に乗じて損益計算・仕訳・取引先別集計に反映する

## 「ソロAI帳簿」からの移植状況

| 機能 | 移植元 | 状況 |
|---|---|---|
| OCRプロンプト・レスポンス整形（税抜金額の突合ロジック含む） | `server.ts` (`/api/receipt-ocr`) | 移植・関数化 (`src/ocr/gemini.ts`) |
| 勘定科目マスタ・複式仕訳・損益集計・貸借対照表 | `src/accounting/{accounts,journal}.ts` | 移植・DBレコード向けに書き換え |
| 消費税申告書の試算（簡易課税/本則課税/2割特例） | `src/tax/consumptionTax.ts` | 移植 (`src/tax/consumptionTax.ts`) |
| 所得税（確定申告）の試算・速算表 | `src/tax/incomeTax.ts` | 移植 (`src/tax/incomeTax.ts`) |
| 固定資産台帳・減価償却費計算（定額法/定率法） | `src/accounting/depreciation.ts`, `src/core/fixedAssets.ts` | 移植。保存先をlocalStorageからDBに変更 (`src/accounting/depreciation.ts`, `fixed_assets`テーブル) |
| 仕訳日記帳・総勘定元帳・消費税区分別集計のCSVエクスポート | `src/documents/exporters.ts` | 移植。クライアント側Blob生成からサーバー側CSV生成に変更 (`src/routes/reports.ts`) |
| インボイス登録番号の形式チェック | — | 元コードに実装なし（プレースホルダー文言のみ）。新規実装 (`src/lib/invoiceNumber.ts`) |
| 経過措置による仕入税額控除率の自動判定 | — | 元コードに実装なし。新規実装 |
| 取引先履歴ベースの勘定科目自動提案（信頼度スコア付き） | — | 元コードはユーザー定義ルールのマッチングのみで履歴学習なし。新規実装 (`src/accounting/categorySuggestion.ts`) |

## 決算書類（損益計算書・貸借対照表・消費税申告書・所得税試算）

[/reports.html](public/reports.html) で年度を指定すると、その年の**承認済み（status=approved）** の証憑から以下を計算・表示する。

- 損益計算書（勘定科目別の収益・経費、売上原価、青色申告特別控除、所得金額）
- 貸借対照表（期首残高は事業者プロフィールから、期中の増減は仕訳から積み上げ。貸借が一致するか自動チェック）
- 消費税申告書の試算（免税/本則課税/簡易課税/2割特例。`invoices.tax_class` で不課税・非課税の取引を除外できる）
- 所得税（確定申告）の試算（所得控除・速算表・復興特別所得税・住民税/事業税概算）
- CSVダウンロード（仕訳日記帳・総勘定元帳・消費税区分別集計。他の会計ソフトへの移行や税理士への提出用）

これらの計算に必要な情報（氏名・屋号・申告区分・所得控除・期首残高・消費税の課税方式など）は [/profile.html](public/profile.html) の事業者プロフィール設定（年度ごと、`business_profiles`テーブル）で入力する。固定資産（減価償却費）は [/fixed-assets.html](public/fixed-assets.html) の台帳で管理し、所得税試算に自動反映される。

**重要**: 税率・控除額・速算表は年度により改正される。ここでの計算結果はあくまで試算であり、実際の申告前には必ず国税庁の最新資料で確認すること（`src/tax/incomeTax.ts`, `src/accounting/depreciation.ts` のコメントにも同様の注意書きあり）。

## デプロイ（現在の本番構成）

**すべて無料プランのみで運用している**（課金は一切発生させない方針）。

- **Web**: [Render](https://render.com) の無料Webサービス（`accounting-agent`、Singaporeリージョン）
  - デプロイURL: https://accounting-agent-bhlz.onrender.com
  - Renderダッシュボード: https://dashboard.render.com/web/srv-daojjsmgekts73chv7q0
  - GitHub `main` ブランチへのpushで自動デプロイ（`autoDeploy: yes`）
- **DB**: [Neon](https://neon.tech) の無料Postgres（GitHubログインで作成、プロジェクトID `dry-dew-38244877`、Singaporeリージョン）
  - Render自前のPostgres無料プランは**30日で自動削除**されるため使っていない。Neonの無料プランは削除期限がない（コンピュートは非アクティブ時にスケール to zeroするだけでデータは消えない）
  - `DATABASE_URL` はRenderのWeb ServiceのEnvironmentタブに直接手入力で設定している（Neonの接続文字列はダッシュボードの「Connect」からのみ確認できる。エージェントは秘密情報を扱わない方針のため、この値の入力は常にユーザー自身が行う）
- Fly.ioは当初の想定だったが、新規組織は支払い方法（カード）登録前だとMachineを作成できない制限があり保留中。`fly.toml` は残してあるので、カード登録後に切り替えも可能（下記）

環境変数を変更する場合は Render ダッシュボード → `accounting-agent` → Environment → Edit で編集し、Saveすると自動で再ビルド・再デプロイされる。デプロイ時のコンテナ起動コマンドが `migrate` → `server` の順で実行されるため、マイグレーション適用漏れは発生しない。

**既知の制約**: Renderの無料プランは永続ディスクに対応していないため、`UPLOAD_DIR=/tmp/uploads` はコンテナ再起動・再デプロイのたびに消える。元ファイル（レシート画像等）を長期保存したい場合は、有料プランでディスクを追加するか、S3/R2などのオブジェクトストレージに切り替える必要がある（`source_file_path` を保存しているだけの `src/pipeline/ingestInvoice.ts` の `saveUploadedFile` を差し替えれば対応可能）。

### render.yaml から作り直す場合

リポジトリ直下の `render.yaml` を使い、Render の Blueprint機能でWebサービスを作成できる（Postgresは含めていない。上記の理由でNeon等の削除期限なし無料DBを別途用意し、Apply後にDATABASE_URLを手動設定すること）。

1. Render ダッシュボード → New → Blueprint → このGitHubリポジトリを選択 → Apply
2. Web ServiceのEnvironmentタブで `DATABASE_URL`（Neon等の接続文字列）と `GEMINI_API_KEY` を設定（どちらも `sync: false` のため自動では入らない）

### Fly.io（カード登録後の代替手段）

```bash
fly launch --no-deploy   # fly.toml のapp名が衝突する場合はここで変更される
fly postgres create      # 未作成なら
fly postgres attach <postgres-app-name>   # DATABASE_URL を自動セット
fly secrets set GEMINI_API_KEY=xxxx
fly volumes create accounting_agent_data --size 1
fly deploy
```

## 未実装（今回のスコープ外・将来拡張）

- 認証（現状は単一運用者を想定し、`approver` は画面の自己申告テキスト入力で、ログイン機構はない）
- 会計ソフトAPI（freee/マネーフォワード等）への自動仕訳登録
- 複数事業者・複数拠点対応、`invoice-estimate-tool` との統合
- スキャン画像PDF（複数ページ）のページ単位合計突き合わせ（現状はテキスト埋め込み型PDFのみ対応）
