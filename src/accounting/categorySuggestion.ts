/**
 * 仕訳ロジック（勘定科目の自動提案）。
 *
 * 「ソロAI帳簿」の accountRules.ts はユーザー定義ルールのマッチングのみで、
 * 「取引先マスタの過去の紐付け履歴から自動提案する」機能は存在しなかったため、ここで新規実装する。
 * - 取引先に紐付け履歴があればそれを最優先（信頼度スコア付き）
 * - 初見の取引先は品目・摘要テキストからのキーワード推測にフォールバック
 */

export type CategorySource = 'vendor_history' | 'keyword_guess' | null;

export interface CategorySuggestion {
  category: string | null;
  confidence: number; // 0-100
  source: CategorySource;
}

export interface VendorCategoryHistoryEntry {
  category: string;
  matchCount: number;
}

/** 取引先の過去の勘定科目紐付け履歴から、最も頻度の高い科目を信頼度スコア付きで返す */
export function suggestFromVendorHistory(
  history: VendorCategoryHistoryEntry[]
): CategorySuggestion {
  if (history.length === 0) {
    return { category: null, confidence: 0, source: null };
  }
  const top = [...history].sort((a, b) => b.matchCount - a.matchCount)[0];
  // 1回だけの一致は信頼度を低めに、繰り返し使われているほど信頼度を上げる（99を上限にする）
  const confidence = Math.min(99, 50 + top.matchCount * 10);
  return { category: top.category, confidence, source: 'vendor_history' };
}

/**
 * 初見の取引先向けの、品目・摘要テキストからのキーワード推測。
 * 「ソロAI帳簿」の server.ts の OCRプロンプトが使っていた経費科目候補リストをベースに、
 * 整体院のような役務提供業でも使う頻度の高いキーワードを補っている。
 */
// より限定的なキーワード（例: 「駐車場代」）を、それを部分文字列として含むより広いキーワード
// （例: 「駐車場」）より前に置くこと。先勝ちマッチなので、順序が逆だと後者のルールが
// 永久にマッチしなくなる（駐車場代の請求が常に旅費交通費に分類されてしまう）。
const KEYWORD_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /電気|ガス|水道|光熱/, category: '水道光熱費' },
  { pattern: /携帯|スマホ|プロバイダ|インターネット|通信|電話料金/, category: '通信費' },
  { pattern: /家賃|賃料|テナント料/, category: '地代家賃' },
  { pattern: /車検|洗車|駐車場代|カー用品/, category: '車両費' },
  { pattern: /タクシー|電車|バス|新幹線|駐車場|ガソリン|高速道路/, category: '旅費交通費' },
  { pattern: /広告|チラシ|ホームページ|web制作|Web広告|SNS広告/i, category: '広告宣伝費' },
  { pattern: /接待|懇親会|贈答|手土産/, category: '接待交際費' },
  { pattern: /保険料/, category: '損害保険料' },
  { pattern: /修理|修繕|メンテナンス/, category: '修繕費' },
  { pattern: /文房具|事務用品|消耗品|備品|タオル|施術用品/, category: '消耗品費' },
  { pattern: /振込手数料|手数料|ATM/, category: '支払手数料' },
  { pattern: /研修|セミナー|講習会/, category: '研修費' },
  { pattern: /書籍|新聞|雑誌|購読料/, category: '新聞図書費' },
  { pattern: /外注|業務委託費|委託料/, category: '外注工賃' },
  { pattern: /仕入|商品原価|材料費/, category: '仕入高' },
];

export function suggestFromKeywords(text: string, direction: 'income' | 'expense'): CategorySuggestion {
  if (direction === 'income') {
    // 収益側は品目からの推測より、既定の売上科目を使う運用の方が事故が少ないため対象外にする
    return { category: null, confidence: 0, source: null };
  }
  const normalized = (text || '').trim();
  if (!normalized) return { category: null, confidence: 0, source: null };

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(normalized)) {
      return { category: rule.category, confidence: 55, source: 'keyword_guess' };
    }
  }
  return { category: null, confidence: 0, source: null };
}

/** 取引先履歴を優先し、なければキーワード推測にフォールバックする統合エントリポイント */
export function suggestCategory(params: {
  vendorHistory: VendorCategoryHistoryEntry[];
  itemText: string;
  direction: 'income' | 'expense';
}): CategorySuggestion {
  const fromHistory = suggestFromVendorHistory(params.vendorHistory);
  if (fromHistory.category) return fromHistory;
  return suggestFromKeywords(params.itemText, params.direction);
}
