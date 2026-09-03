/**
 * 🔵 Intent: NF-4-3「審査ルール・確信度閾値・名寄せスコアリングの重みは定数として一元管理し、
 * ロジック内に散在させない」に従い、F-6（名寄せ）まわりで要件に明記が無く実装時に判断した
 * 定数（決定#22・#26）だけをこのファイルへ集約する。営業デモの運用で調整が要りそうな値
 * （スコアの重み、OCRラベルの表記ゆれ辞書）は、ここだけを直せば済むようにする。
 */

/**
 * 🔴 Intent: F-6-3は条件の分類（高スコア2種・中スコア1種）のみを定め、具体的な重みは
 * 要件に明記がない。高スコア2条件を同じ重みにする（決定#22）。
 */
export const SCORE_WEIGHTS = {
  kanaAndBirthDate: 60,
  name: 30,
  phone: 60,
} as const;

/**
 * 🔴 Intent: OCR抽出項目（`ApplicationField[]`）から名寄せ第1段へ渡す氏名・氏名カナ・
 * 生年月日・電話番号を、どのラベル文字列（完全一致）で拾うかは要件に明記が無い（決定#26）。
 * F-5-2の項目名を主とし、紙帳票で頻出する同義語を加える。今後「カナ氏名」等の別表記が
 * 実際のOCR出力で見つかった場合は、該当するSetへ文字列を追加するだけでよい。
 */
export const NAME_LABELS = new Set(["氏名"]);

export const NAME_KANA_LABELS = new Set([
  "氏名カナ",
  "氏名（カナ）",
  "フリガナ",
  "ふりがな",
]);

export const BIRTH_DATE_LABELS = new Set(["生年月日"]);

export const PHONE_LABELS = new Set(["電話番号", "電話"]);
