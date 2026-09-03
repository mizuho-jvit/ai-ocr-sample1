/**
 * 🔵 Intent: Gemini呼び出し（Pass①・Pass②）のシステム指示とレスポンススキーマを1箇所へ
 * 集約する。営業デモの運用でAIの挙動（抽出精度・判定基準）を調整する際、
 * ocr-pipeline.ts・business-check-ai.tsのオーケストレーションコードを触らずに
 * このファイルだけを編集すればよいようにする（matching-constants.tsと同じ方針）。
 */

/**
 * 🔴 Intent: Pass①（帳票読取・F-2-4・F-2-7）のプロンプト。事務局記入欄の除外と空欄の扱いは
 * 前工程（functional.md）の記述に沿うが、文面自体は前工程に指定が無いためAIが補完した。
 */
export const OCR_EXTRACT_SYSTEM_INSTRUCTION = `あなたは日本語の紙帳票を読み取るOCRアシスタントです。
入力された1枚の帳票画像から、次のJSONスキーマに従って情報を抽出してください。

- docType: 帳票の種類を判別する（例:「利用者登録申請書」）。
- fields: 申請者記入欄の項目をラベルと値のペアで、記載されている順にすべて抽出する。
  - 空欄の項目も除外せず、value を空文字列として含める。
  - 「使用欄」「事務局記入欄」「受理番号」等、職員が記入する欄は fields に含めない。
  - 各項目に 0 以上 1 以下の確信度 confidence を付与する。

推測で値を作らず、判読できない場合は confidence を低くしてください。`;

/**
 * 🟡 Intent: Gemini Structured OutputsのresponseSchemaはGoogle Generative Language APIの
 * Schema表現(型名は大文字の列挙値)に従う。ネットワーク制限によりライブのAPIドキュメントで
 * 検証できていないため、実際のGemini応答で確認が必要(要人手確認)。
 */
export const OCR_EXTRACT_RESPONSE_SCHEMA = {
  properties: {
    docType: { type: "STRING" },
    fields: {
      items: {
        properties: {
          confidence: { type: "NUMBER" },
          label: { type: "STRING" },
          value: { type: "STRING" },
        },
        required: ["label", "value", "confidence"],
        type: "OBJECT",
      },
      type: "ARRAY",
    },
  },
  required: ["docType", "fields"],
  type: "OBJECT",
};

/**
 * 🔴 Intent: Pass②（AI業務チェック・F-3-1〜5）のプロンプト。前工程（functional.md）は
 * 各判定の意味を定めるが、文面自体は指定が無いためAIが補完した。
 * 🔵 Intent: F-6-5（名寄せ候補の同一人物判定）はここに含めない。既存会員の個人情報を
 * AIへ送信しない方針（決定#27）のため、候補データはこの呼び出しへ一切渡さない。
 */
export const BUSINESS_CHECK_SYSTEM_INSTRUCTION = `あなたは日本の対人援助サービス事業所で申請書の一次審査を行うAIアシスタントです。
入力は、OCRで読み取った申請書の項目（ラベルと値のペア）です。次のJSONスキーマに従って
判定結果を出力してください。

- consistency: 項目間の論理矛盾を検出する（郵便番号と住所の不整合、氏名とカナの不整合、
  日付として成立しない値 等）。重要度は error（明確な矛盾）または warning（疑わしい）とする。
- deficiencies: 必須項目の記入漏れを検出する。値が空文字列の任意項目は対象に含めない。
- triage: "approval_candidate"（承認候補）／"needs_review"（要審査）／
  "return_candidate"（差戻し候補）のいずれかを選ぶ。
- triageReason: triageの理由を1〜2文で述べる。
- letterDraft: 不備または矛盾がある場合のみ、申請者への差戻し連絡文の下書きを
  敬体・200字以内で生成する。宛名・差出人は「○○様」「事業所名」のようなプレースホルダとする。
  不備・矛盾が無い場合は null とする。

推測で断定せず、判断材料が不十分な場合はneeds_reviewを選んでください。`;

export const BUSINESS_CHECK_RESPONSE_SCHEMA = {
  properties: {
    consistency: {
      items: {
        properties: {
          labels: { items: { type: "STRING" }, type: "ARRAY" },
          message: { type: "STRING" },
          severity: { enum: ["error", "warning"], type: "STRING" },
        },
        required: ["labels", "severity", "message"],
        type: "OBJECT",
      },
      type: "ARRAY",
    },
    deficiencies: {
      items: {
        properties: {
          label: { type: "STRING" },
          message: { type: "STRING" },
        },
        required: ["label", "message"],
        type: "OBJECT",
      },
      type: "ARRAY",
    },
    letterDraft: { nullable: true, type: "STRING" },
    triage: {
      enum: ["approval_candidate", "needs_review", "return_candidate"],
      type: "STRING",
    },
    triageReason: { type: "STRING" },
  },
  required: [
    "triage",
    "triageReason",
    "consistency",
    "deficiencies",
    "letterDraft",
  ],
  type: "OBJECT",
};
