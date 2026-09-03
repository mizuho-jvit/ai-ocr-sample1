---
id: "008"
title: "名寄せの正規化と候補抽出を実装"
status: done
priority: 1
dependencies: ["001", "002"]
estimated_complexity: high
---

# Task: 名寄せの正規化と候補抽出を実装

## Goal

AIを使わない決定的な正規化とテナント内上位5件候補抽出を作る。

## Interfaces

```ts
function normalizeMemberInput(input: MemberIdentity): NormalizedMemberIdentity; // 🔵
function findMatchCandidates(scope: TenantScope, input: NormalizedMemberIdentity): Promise<RuleMatchCandidate[]>; // 🔵
```

## Test Strategy

- [x] 仙臺/仙台、NFKC、かな、和暦、電話ハイフンを正規化する。
- [x] 未登録文字と原文を変更しない。
- [x] カナ+生年月日、電話、氏名で採点し上位5件だけ返す（住所は一致条件に含めない。決定#21）。
- [x] 他テナントとrejected済み候補を返さない。
- [x] 実在しない年月日・改元当日の月日境界を跨ぐ和暦はApiErrorException("INVALID_DATE")で拒否する。
- [x] 生年月日区切りのダッシュ系異体字（U+2010・U+2015・U+2212・U+30FC）を半角ハイフンへ畳み込む。
- [x] `members.phone`/`birthDate`の形式をDB CHECK制約で強制し、非数字の電話番号や`YYYY-MM-DD`以外の生年月日を書き込み時に拒否する。
- [x] `TableRepository.find(where)`が同一条件に合致する複数行（同じ電話番号を共有する会員等）を取りこぼさずに返す。

## Implementation Notes

- 対応表はGit追跡JSON。ルール段階でAIを呼ばない。
- `MemberIdentity` / `NormalizedMemberIdentity` / `TenantScope` / `RuleMatchCandidate` は要件のDTOではなくWorker内部専用の型のため、`contracts.ts`ではなく各サービスファイル内に定義した。
- `TenantScope = { repositories: TenantScopedRepositories; applicationId: ApplicationId }`。`applicationId`を持たせることで、F-6-10の「このapplicationIdに対してrejected済みの組み合わせを除外」をこの関数の内側で行える（Task 009はrunBusinessCheckの対象applicationIdをそのまま渡すだけでよい）。
- 当初`TenantScope.db`は生の`ScopedDb`だったが、DI層（`context.get("repository").forTenant()`）は`TenantScopedRepositories`しか返さないため、`findMatchCandidates`の呼び出し元がDIを迂回して`createScopedDatabase`を自前で作る必要がある設計不整合が見つかった（[決定#24](../../../../../knowledge/wiki/requirements/decisions.md)）。原因は`TableRepository`に条件付き複数行取得のメソッドが無かったこと（`all()`は無条件、`findOne()`は1件のみで、同じ電話番号・氏名を共有する会員を取りこぼす）。`TableRepository`へ`find(where): Promise<Row[]>`を追加し（`src/worker/db/repositories.ts`）、`TenantScope`を`repositories: TenantScopedRepositories`で受け取る形に変更した。
- `applicationId`必須がTask 013の`exportApplications`と噛み合わないという当初の懸念は、`exportApplications`（申請台帳のCSVエクスポート）が`findMatchCandidates`もF-6-10のrejected除外も呼ばないため、そもそも`TenantScope`を再利用する理由が無いと判明し解消した。Task 013のタスクファイルの疑似コードを`repositories: TenantScopedRepositories`（`applicationId`なし）へ修正し、`matching.ts`の`TenantScope`を再利用しないよう実装メモに明記した。`matching.ts`側の変更は不要。
- スコアの重み（カナ+生年月日=60、電話=60、氏名一致=30）はF-6-3が条件の分類のみを定め具体的な数値を明記していないための設計判断（NF-4-3により`SCORE_WEIGHTS`定数へ一元化・`src/worker/services/matching.ts`。[決定#22](../../../../../knowledge/wiki/requirements/decisions.md)）。値を変える場合はこの定数のみを変更すればよい。
- 氏名一致条件は当初「氏名一致＋住所前方一致」だったが、`memberAddress.startsWith(input.address)`が「入力側住所の方が簡略」という一方向の前提に依存し、逆方向（OCR側の方が詳細）を検出できない設計上の欠陥が見つかったため、住所を条件から外し氏名一致のみとした（[決定#21](../../../../../knowledge/wiki/requirements/decisions.md)・F-6-3を正典側も更新済み）。これに伴い`MemberIdentity`/`NormalizedMemberIdentity`から`address`フィールドと`normalizeAddress`/`normalizeAddressForComparison`を削除した。`RuleScoreBreakdown.nameAndAddressPrefix`は`name`に改名した。
- 和暦→西暦は「起点年+和暦年-1」で年を求めたうえで、実在する年月日か（存在チェック）と改元当日の月日境界（大正=1912-07-30、昭和=1926-12-25、平成=1989-01-08、令和=2019-05-01。明治のみ史実上の日単位対応が定まらないため西暦1868-01-25を採用）の両方を検証する（[決定#23](../../../../../knowledge/wiki/requirements/decisions.md)）。違反時は`ApiErrorException("INVALID_DATE")`を投げ、`ERROR_MESSAGES`に追加した「不正な日付です。」（422）が呼び出し元へ伝わる（`src/worker/types/{contracts,api-error}.ts`）。日付として一切パースできない値（「不明」等）は従来どおりnullを返しエラーにしない。
- NFKCは全角ハイフンマイナス（U+FF0D）は半角へ畳み込むが、OCR/IME由来で紛れ込みやすい他のダッシュ系文字（U+2010・U+2015・U+2212・長音記号U+30FC）は正規化等価ではないため対象外。生年月日の区切り文字としてのみ`foldDashVariants`で個別に半角ハイフンへ畳み込む（氏名・カナには適用しない。長音記号「ー」は正当なカナ表記のため）。全角スラッシュ「／」はNFKCで半角化されるため対応不要（住所の同種異体字は今回対象外・ユーザー判断で見送り）。
- `scoreMember`は`members.phone`/`birthDate`を`normalizeMemberInput`の出力形式のまま生の値で比較する。この前提を書き込み経路（`normalizeMemberInput`を経由するかどうか）に依存させないため、`src/worker/db/schema.ts`の`members`テーブルへ`members_phone_digits_check`（数字のみ・空文字禁止）と`members_birth_date_format_check`（NULLまたは`YYYY-MM-DD`固定・ゼロ埋め必須）のCHECK制約を追加した。`nameNormalized`/`kanaNormalized`は自由なかな漢字で形式チェックが書けないため対象外のまま（正典は[data-model.md](../../../../../knowledge/wiki/db/data-model.md#member--会員ログインなし)）。マイグレーションは`corepack pnpm db:generate`で`drizzle/0001_friendly_bullseye.sql`として生成した（SQLiteはCHECK制約の追加にテーブル再作成が必要なため、drizzle-kitが自動でその手順を生成する）。制約が実際に機能することは`test/worker/db/schema.test.ts`で検証した。

## Files

- 新規: `src/worker/services/{member-normalizer,matching}.ts`, `src/worker/assets/variant-map.json`
- 新規: `drizzle/0001_friendly_bullseye.sql`（`members`のCHECK制約追加マイグレーション）
- 変更: `src/worker/db/repositories.ts`（`TableRepository.find`を追加）
- テスト: `test/worker/services/{member-normalizer,matching}.test.ts`, `test/worker/db/schema.test.ts`
- 変更: `test/worker/db/repositories.test.ts`（`find`のテストを追加）
