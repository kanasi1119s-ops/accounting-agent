/**
 * PDF請求書の処理分岐: テキスト埋め込み型は直接テキスト抽出、スキャン画像型はOCRへ回す。
 * 複数ページ請求書はページ単位の小計を突き合わせ、合計と食い違えば警告フラグを立てる。
 */
import pdfParse from 'pdf-parse';

export interface PdfTextExtraction {
  /** 抽出できた全文字数がこの値未満なら「テキストがほぼ無い＝スキャン画像PDF」とみなす */
  isTextEmbedded: boolean;
  fullText: string;
  pageTexts: string[];
  pageCount: number;
}

const MIN_CHARS_PER_PAGE_FOR_TEXT_PDF = 20;

export async function extractPdfText(buffer: Buffer): Promise<PdfTextExtraction> {
  const pageTexts: string[] = [];

  await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      const content = await pageData.getTextContent();
      const text = content.items.map((item: any) => item.str).join(' ');
      pageTexts.push(text);
      return text;
    },
  });

  const fullText = pageTexts.join('\n\n').trim();
  const pageCount = pageTexts.length || 1;
  const avgCharsPerPage = fullText.length / pageCount;

  return {
    isTextEmbedded: avgCharsPerPage >= MIN_CHARS_PER_PAGE_FOR_TEXT_PDF,
    fullText,
    pageTexts,
    pageCount,
  };
}

/**
 * ページごとの「小計」「合計」等の金額表記を拾い、全ページ合計が書類全体の合計と一致するか突き合わせる。
 * ヒューリスティック（表記ゆれに完全対応はしない）なので、不一致は必ず承認キューでの目視確認に回し、
 * 自動判断（却下等）はしない。
 */
export interface MultiPageTotalCheck {
  checked: boolean;
  sumOfPageSubtotals: number | null;
  mismatch: boolean;
  notes: string[];
}

const SUBTOTAL_PATTERN = /(?:小計|合計|ページ計)[:\s]*[¥￥]?\s*([0-9,]+)/;

export function checkMultiPageTotal(pageTexts: string[], reportedGrandTotal: number | null): MultiPageTotalCheck {
  if (pageTexts.length <= 1) {
    return { checked: false, sumOfPageSubtotals: null, mismatch: false, notes: [] };
  }
  if (reportedGrandTotal === null) {
    return {
      checked: false,
      sumOfPageSubtotals: null,
      mismatch: false,
      notes: ['書類全体の合計金額が未確定のため、ページ単位の突き合わせをスキップしました。'],
    };
  }

  const perPageAmounts: number[] = [];
  for (const page of pageTexts) {
    const match = page.match(SUBTOTAL_PATTERN);
    if (!match) {
      return {
        checked: false,
        sumOfPageSubtotals: null,
        mismatch: false,
        notes: ['一部のページで小計・合計の記載を検出できなかったため、ページ単位の突き合わせをスキップしました。'],
      };
    }
    perPageAmounts.push(Number(match[1].replace(/,/g, '')));
  }

  const sum = perPageAmounts.reduce((a, b) => a + b, 0);
  const mismatch = Math.abs(sum - reportedGrandTotal) > 1;

  return {
    checked: true,
    sumOfPageSubtotals: sum,
    mismatch,
    notes: mismatch
      ? [`ページ別合計の合算 (${sum}円) と書類全体の合計 (${reportedGrandTotal}円) が一致しません。`]
      : [],
  };
}
