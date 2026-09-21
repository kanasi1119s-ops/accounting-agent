# accounting-agent

個人事業主/中小企業向けの経理・請求書処理を行う自律型AIエージェント（サーバーサイド版）。

「ソロAI帳簿」（完全ローカル動作の配布用ソフト）とは別プロジェクトとして、外部API連携ありのサーバーサイドで構築している。最初の実運用先は個人整体院「旭身体LABO」の経理記帳。

## 段階的リリース方針

- **フェーズ1（現在）**: OCR抽出 → 検証 → 仕訳提案までは自動化するが、**自動仕訳・自動承認は一切行わない**。すべて `approval_queue` に入り、人間の確認・承認を待つ。
- **フェーズ2**: `settings.auto_approval_enabled` を有効化すると、信頼度が高い（`category_confidence_threshold` 以上）案件だけワンクリック承認UIの対象にできる（UI側は未実装、APIの土台のみ用意）。
- **フェーズ3**: `settings.full_auto_enabled` を有効化すると、閾値未満の完全自動仕訳が視野に入る。旭身体LABOでの運用実績を見てから判断する。

## セットアップ

```bash
cp .env.example .env
# DATABASE_URL, GEMINI_API_KEY を設定
npm install
npm run migrate   # migrations/ 配下のSQLを順番に適用
npm run dev
```

## 主要なディレクトリ

- `migrations/` — プレーンSQLのマイグレーションファイル。`src/db/migrate.ts` が `schema_migrations` テーブルで適用済みを管理し、未適用分だけを順番に実行する。
- `src/lib/` — OCRやDBに依存しない純粋ロジック（インボイス番号形式チェック、税抜税込整合性チェック、重複検知ハッシュ）。
- `src/ocr/` — Gemini Vision呼び出し（画像・スキャンPDF用）と、テキスト埋め込み型PDFの直接テキスト抽出。
- `src/accounting/` — 勘定科目マスタ、仕訳・決算集計ロジック、取引先履歴ベースの科目自動提案。
- `src/pipeline/ingestInvoice.ts` — OCR取込 → 検証 → 仕訳提案 → 承認キュー投入までを一気通貫で行うオーケストレーター。
- `src/routes/` — Express APIルート（アップロード、承認、設定、レポート）。
- `src/repositories/` — DBアクセス層。

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

## Fly.io へのデプロイ

```bash
fly launch --no-deploy   # fly.toml のapp名が衝突する場合はここで変更される
fly postgres create      # 未作成なら
fly postgres attach <postgres-app-name>   # DATABASE_URL を自動セット
fly secrets set GEMINI_API_KEY=xxxx
fly volumes create accounting_agent_data --size 1
fly deploy
```

デプロイ時のコンテナ起動コマンドが `migrate` を実行してから `server` を起動するため、マイグレーションの適用漏れは発生しない。

## 未実装（今回のスコープ外・将来拡張）

- 承認キュー・按分ルール設定のフロントエンドUI（現状はAPIのみ）
- 認証（現状は単一運用者を想定し、`approver` は自己申告の文字列）
- 会計ソフトAPI（freee/マネーフォワード等）への自動仕訳登録
- 複数事業者・複数拠点対応、`invoice-estimate-tool` との統合
- スキャン画像PDF（複数ページ）のページ単位合計突き合わせ（現状はテキスト埋め込み型PDFのみ対応）
