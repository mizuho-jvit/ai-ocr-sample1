---
id: "010"
title: "申請管理と名寄せ判断画面を実装"
status: done
priority: 2
dependencies: ["003", "004", "009"]
estimated_complexity: high
---

# Task: 申請管理と名寄せ判断画面を実装

## Goal

申請の一覧、詳細、項目編集、状態遷移、CheckRun履歴、候補判断を職員が扱えるようにする。

## Interfaces

```ts
function changeApplicationStatus(id: string, input: ChangeAppStatusRequest, actor: SessionActor): Promise<ChangeAppStatusResponse>; // 🔵
function decideMatch(id: string, candidateId: string, input: DecideMatchRequest): Promise<DecideMatchResponse>; // 🔵
```

## Test Strategy

- [x] 指定フィルタと要審査ビューでテナント内だけを返す。
- [x] 編集者と編集済みフラグを記録しAI確信度は変えない。
- [x] 許可遷移だけを通し、承認でpending会員をactive化して履歴化する。
- [x] merged/rejected/holdの判断と左右差分表示が正しい。

## Implementation Notes

- 静的ルートを`:id`より先に登録する。後着優先で排他制御はしない（Task 013のexport.csvはまだ無いため、現時点では`:id`配下のパスのみで衝突は生じない）。
- 業務ロジックは`src/worker/services/application-service.ts`へ切り出し、`routes/applications.ts`はリクエスト検証とセッション解決だけを行う（`routes/checks.ts`と同じ方針）。詳細・判断の根拠は`knowledge/wiki/log.md`の2026-09-03の項と[決定#29〜31](../../../../knowledge/wiki/requirements/decisions.md)を参照。
- SPAにルーターは導入せず、`AppShell`の内部状態で画面を切り替える（決定#31）。ナビメニューは「ホーム」「申請状況一覧」のみ有効化。

## Files

- 新規: `src/worker/{routes/applications.ts,services/application-service.ts}`, `src/react-app/{api/applications.ts,labels.ts,components/match-candidate-card.tsx,pages/application-list-page.tsx,pages/application-detail-page.tsx}`
- 変更: `src/worker/{index.ts,middleware/auth.ts,services/application-view.ts}`, `src/react-app/components/app-shell.tsx`
- テスト: `test/worker/services/application-service-{read,status,match}.test.ts`, `test/worker/routes/applications-{query,mutation}.test.ts`（500行ルールにより分割）, `test/react-app/{api/applications.test.ts,pages/application-list-page.test.tsx,pages/application-detail-page.test.tsx}`, `test/react-app/components/app-shell.test.tsx`（既存へ追記）
