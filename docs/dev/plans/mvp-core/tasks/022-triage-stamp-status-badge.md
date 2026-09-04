---
id: "022"
title: "判子スタンプ・ステータスバッジを実装"
status: done
priority: 3
dependencies: ["007", "010"]
estimated_complexity: low
---

# Task: 判子スタンプ・ステータスバッジを実装

## Goal

overview.md「デザイン要件」の「判定表示｜判子風の円形スタンプ」と、申請ステータスのバッジ表示を
実装する。`theme.css`新設時（Task 007）に「デモ固有の演出は後続タスクの対象」として明示的に未実装
のまま残っており（acceptance.md「判子風スタンプが維持されている」も未達）、その後どのタスクでも
拾われていなかった（[決定#36](../../../../knowledge/wiki/requirements/decisions.md)）。

## Interfaces

```ts
interface TriageStampProps {
  triage: Triage | null; // nullは「未実施」の点線スタンプ
  size?: number;
}
interface AppStatusBadgeProps {
  status: AppStatus;
}
```

## Test Strategy

- [x] `triage: null`のとき「未実施」を表す点線スタンプが表示される。
- [x] `triage`が結果を持つとき、結果ラベルを含む実線スタンプが表示される（4文字以上は2行に折り返す）。
- [x] `AppStatusBadge`が4つのステータスすべてでラベルを表示する。
- [x] 申請状況一覧・申請詳細画面の既存テストが壊れていない（スタンプの`aria-label`でセルのアクセシブルネームが変わる箇所は問い合わせ方法を調整した）。

## Implementation Notes

- プロトタイプ`ai-ocr-demo.jsx`の`TriageStamp`・`AppStatusBadge`をそのまま踏襲した。色はプロトタイプのハードコード16進値ではなく、既存の`theme.css`のCSSカスタムプロパティ（`--ok-green`・`--amber-border`・`--vermilion`・`--ink-soft`）に対応付け直した。
- `TriageStamp`の`<span>`はBiomeの`lint/a11y/useAriaPropsSupportedByRole`により`aria-label`だけでは通らず、`role="img"`を付与した。これにより囲むセルのアクセシブルネームがスタンプの`aria-label`（例:「AI判定: 要審査」）に置き換わるため、`application-list-page.test.tsx`の該当セルのテストは`getByRole("cell", ...)`から`getByLabelText`へ変更した。
- 配線先: 申請詳細画面のヘッダー（`TriageStamp` + `AppStatusBadge`）、業務チェック結果カード（`TriageStamp`）、申請状況一覧の各行（両方）。業務チェック履歴の一覧行（コンパクトな`<li>`）はスタンプを使わずプレーンテキストのまま維持した（密度を優先）。
- アップロードされた原本画像以外の静的画像（アイコン等）はこのタスクの対象外（ユーザー確認済み）。

## Files

- 新規: `src/react-app/components/{triage-stamp,app-status-badge}.tsx`
- 変更: `src/react-app/pages/{application-detail-page.tsx,application-list-page.tsx}`, `knowledge/wiki/requirements/decisions.md`
- テスト: `test/react-app/components/{triage-stamp,app-status-badge}.test.tsx`, `test/react-app/pages/application-list-page.test.tsx`
