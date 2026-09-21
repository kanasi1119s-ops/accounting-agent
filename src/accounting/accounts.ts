/**
 * 勘定科目マスタ。「ソロAI帳簿」の src/accounting/accounts.ts を移植し、
 * 青色申告決算書の科目並びをそのまま踏襲している。
 */
export type AccountKind = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface AccountDef {
  name: string;
  kind: AccountKind;
  order: number;
}

const A = (name: string, kind: AccountKind, order: number): AccountDef => ({ name, kind, order });

export const ACCOUNTS: AccountDef[] = [
  // ---- 収益 ----
  A('売上高', 'revenue', 400),
  A('業務委託報酬', 'revenue', 401),
  A('雑収入', 'revenue', 420),

  // ---- 費用 ----
  A('仕入高', 'expense', 500),
  A('租税公課', 'expense', 510),
  A('荷造運賃', 'expense', 511),
  A('水道光熱費', 'expense', 512),
  A('旅費交通費', 'expense', 513),
  A('通信費', 'expense', 514),
  A('広告宣伝費', 'expense', 515),
  A('接待交際費', 'expense', 516),
  A('損害保険料', 'expense', 517),
  A('修繕費', 'expense', 518),
  A('消耗品費', 'expense', 519),
  A('減価償却費', 'expense', 520),
  A('福利厚生費', 'expense', 521),
  A('給料賃金', 'expense', 522),
  A('外注工賃', 'expense', 523),
  A('利子割引料', 'expense', 524),
  A('地代家賃', 'expense', 525),
  A('貸倒金', 'expense', 526),
  A('法定福利費', 'expense', 530),
  A('会議費', 'expense', 540),
  A('新聞図書費', 'expense', 541),
  A('支払手数料', 'expense', 542),
  A('車両費', 'expense', 543),
  A('研修費', 'expense', 544),
  A('雑費', 'expense', 590),

  // ---- 資産・負債・資本（按分不要・仕訳画面表示用） ----
  A('現金', 'asset', 100),
  A('普通預金', 'asset', 110),
  A('売掛金', 'asset', 120),
  A('事業主貸', 'asset', 195),
  A('買掛金', 'liability', 200),
  A('未払金', 'liability', 210),
  A('クレジットカード', 'liability', 211),
  A('事業主借', 'liability', 295),
  A('元入金', 'equity', 300),
];

const ACCOUNT_MAP = new Map(ACCOUNTS.map((a) => [a.name, a]));

export function getAccount(name: string): AccountDef | undefined {
  return ACCOUNT_MAP.get(name);
}

export function accountKind(name: string, fallback: AccountKind = 'expense'): AccountKind {
  return ACCOUNT_MAP.get(name)?.kind ?? fallback;
}

/** 家事按分の検討が必要になりやすい経費科目（自動計算はせず、按分ルール設定へ誘導する対象） */
export const ALLOCATION_PRONE_CATEGORIES = new Set([
  '水道光熱費',
  '通信費',
  '地代家賃',
  '車両費',
  '旅費交通費',
]);

export function isAllocationProne(category: string | null): boolean {
  if (!category) return false;
  return ALLOCATION_PRONE_CATEGORIES.has(category);
}

/** 経費カテゴリの候補一覧（キーワード推測・承認画面のプルダウン等で使用） */
export const EXPENSE_CATEGORIES: string[] = ACCOUNTS.filter((a) => a.kind === 'expense').map((a) => a.name);

/** 収益カテゴリの候補一覧 */
export const REVENUE_CATEGORIES: string[] = ACCOUNTS.filter((a) => a.kind === 'revenue').map((a) => a.name);
