/**
 * 🔵 Intent: OCR抽出項目(`ApplicationField[]`)から氏名・氏名カナ・生年月日・電話番号を
 * どのラベル文字列(表記ゆれ含む)で拾うかの辞書(決定#26)。名寄せ判定
 * (`worker/services/business-check.ts`)と申請詳細画面の名寄せ候補カード
 * (`react-app/components/match-candidate-card.tsx`)の両方が同じ辞書を参照する必要があるため
 * (コードレビュー指摘#6)、Worker固有サービス・SPA固有コードのどちらにも依存しない純粋データ
 * としてここに置く(決定#38)。外部I/O・Cloudflare依存を持たないため、SPAから`import type`
 * ではなく通常importで参照してよい唯一の例外とする。
 */

export const NAME_LABELS: ReadonlySet<string> = new Set(["氏名"]);

export const NAME_KANA_LABELS: ReadonlySet<string> = new Set([
  "氏名カナ",
  "氏名（カナ）",
  "フリガナ",
  "ふりがな",
]);

export const BIRTH_DATE_LABELS: ReadonlySet<string> = new Set(["生年月日"]);

export const PHONE_LABELS: ReadonlySet<string> = new Set(["電話番号", "電話"]);

/**
 * `labels`のいずれかとラベルが一致する最初の項目の値を返す。前後空白はラベル・値どちらも
 * trimして比較・判定し、値が空文字になる場合はnullを返す(項目が無い場合と区別しない)。
 */
export function findFieldValueByLabels(
  fields: ReadonlyArray<{ label: string; value: string }>,
  labels: ReadonlySet<string>,
): string | null {
  const field = fields.find((candidate) => labels.has(candidate.label.trim()));
  if (!field || field.value.trim().length === 0) {
    return null;
  }
  return field.value;
}
