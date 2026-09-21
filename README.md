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
- `src/accounting/` — 勘定科目マスタ、仕訳・決算集計ロジック、取引先履歴ベースの科目自動提案。
- `src/pipeline/ingestInvoice.ts` — OCR取込 → 検証 → 仕訳提案 → 承認キュー投入までを一気通貫で行うオーケストレーター。
- `src/routes/` — Express APIルート（アップロード、承認、設定、レポート）。
- `src/repositories/` — DBアクセス層。
- `public/` — 承認キュー用の簡易画面（ビルド不要のvanilla HTML/JS）。`index.html` が一覧・取込・設定、`invoice.html` が証憑1件の詳細・手動修正・外貨レート指定。

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

## 「ソロAI帳簿」からの移植状況

| 機能 | 移植元 | 状況 |
|---|---|---|
| OCRプロンプト・レスポンス整形（税抜金額の突合ロジック含む） | `server.ts` (`/api/receipt-ocr`) | 移植・関数化 (`src/ocr/gemini.ts`) |
| 勘定科目マスタ・複式仕訳・損益集計 | `src/accounting/{accounts,journal}.ts` | 移植・DBレコード向けに書き換え |
| インボイス登録番号の形式チェック | — | 元コードに実装なし（プレースホルダー文言のみ）。新規実装 (`src/lib/invoiceNumber.ts`) |
| 経過措置による仕入税額控除率の自動判定 | — | 元コードに実装なし。新規実装 |
| 取引先履歴ベースの勘定科目自動提案（信頼度スコア付き） | — | 元コードはユーザー定義ルールのマッチングのみで履歴学習なし。新規実装 (`src/accounting/categorySuggestion.ts`) |

## デプロイ

当初はFly.ioを想定していたが、新規Fly組織は支払い方法（カード）登録前だとMachineを作成できない制限があるため、カード登録不要で始められる **Render** を先に使う運用に切り替えた。`fly.toml` は残してあるので、カード登録後にFly.ioへ切り替えることも可能。

### Render（現在の想定）

リポジトリ直下の `render.yaml` を使い、Render の Blueprint機能でWebサービスとPostgresを一括作成する。

1. Render ダッシュボード → New → Blueprint → このGitHubリポジトリを選択
2. `render.yaml` の内容がプレビューされるので確認して Apply
3. 作成後、Web ServiceのEnvironmentタブで `GEMINI_API_KEY` を設定（`sync: false` のため自動では入らない）
4. デプロイ完了後、コンテナ起動コマンドが `migrate` → `server` の順で実行されるため、マイグレーション適用漏れは発生しない

**既知の制約**: Renderの無料プランは永続ディスクに対応していないため、`UPLOAD_DIR=/tmp/uploads` はコンテナ再起動・再デプロイのたびに消える。元ファイル（レシート画像等）を長期保存したい場合は、有料プランでディスクを追加するか、S3/R2などのオブジェクトストレージに切り替える必要がある（`source_file_path` を保存しているだけの `src/pipeline/ingestInvoice.ts` の `saveUploadedFile` を差し替えれば対応可能）。

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

- 按分ルール設定画面（現状は「按分が必要」という警告フラグ (`allocation_required`) が付くだけで、按分ルールの登録・自動計算画面はない）
- 認証（現状は単一運用者を想定し、`approver` は画面の自己申告テキスト入力で、ログイン機構はない）
- 会計ソフトAPI（freee/マネーフォワード等）への自動仕訳登録
- 複数事業者・複数拠点対応、`invoice-estimate-tool` との統合
- スキャン画像PDF（複数ページ）のページ単位合計突き合わせ（現状はテキスト埋め込み型PDFのみ対応）
