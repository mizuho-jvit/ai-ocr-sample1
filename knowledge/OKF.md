# OKF 採用方針（ai-ocr-sample1 での取り入れ方）

> 本書は「**このリポジトリに OKF (Open Knowledge Format) × LLM-Wiki をどう導入するか**」の方針書です。
> 元は OD プロジェクトの docs リポジトリ向け合意文書で、それを `ai-ocr-sample1` 向けに書き換えたもの（変更点は §6）。
> 規約本体（憲法）は同階層の [`SCHEMA.md`](./SCHEMA.md)。
> 汎用的な OKF の説明は kunishima さん保有の「OKF & LLM Wiki の説明（汎用版）」を参照。

## 1. 方針

- **単一リポジトリで完結**させる。KB を別 repo に切り出さない。
- 知識ベース一式は **`knowledge/`** 配下に閉じる（`knowledge/SCHEMA.md` / `knowledge/ref/` / `knowledge/wiki/`）。
- **`raw` 層 = 既存の `input/`** を流用する（`inbox/` は新設しない）。
  - **`input/` は Git 追跡外のまま維持する。** 元方針（B案・原本をコミット）からの変更点。
    理由は `AGENTS.md` / `CLAUDE.md` の「個人情報を含む資料や生成物をコミットしない」が優先されるため。
- **今後の運用**: 人間が書いた文章・受領資料はすべて `input/` に投入 → Claude が `wiki/` を更新・整理 → `wiki/log.md` に記録 → 保持が必要な原本は `knowledge/ref/doc/` へコピー。
- 思想: input（要求ドキュメント・議事録・受領資料等）は Wiki に整理され次第「使い捨て」。**正典は `wiki/` 側**。
- **要約不能な一次資産は `wiki/_assets/` にコミット維持**（構成図、スキーマ定義、OpenAPI 等。ただし実データを含まないもの）。
- `output/` は生成物置き場のまま。Wiki の正典化対象になったものは `wiki/` へ写す。

### 1.1 `input/` と `knowledge/ref/` の役割分担

3つの入力系ディレクトリを**保持期間**で分ける。

| ディレクトリ | 層 | 保持 | 用途 |
|---|---|---|---|
| `input/` | 第1層（raw・揮発） | **使い捨て**。Wiki 化したら削除して良い | 受領資料・議事録・人が書いた要求文書の投入口 |
| `output/` | 生成物（揮発） | Wiki 化したら削除して良い | Claude の生成物（要件定義書など）の置き場 |
| `knowledge/ref/doc/` | 第1層（保持） | **恒久保持。上書き・改変しない** | 要件定義・Wiki を作成した後も原本参照が必要なドキュメント |
| `wiki/_assets/` | 第2層に属する一次資産 | 恒久保持（**Git 追跡対象**） | 要約不能かつ機密を含まない一次資産（構成図・スキーマ定義等） |

運用ルール:

- **`input/` は投入口であって保管場所ではない。** ここにあるファイルはいつ削除されても業務が止まらない状態を保つ。
- 要件定義・Wiki を作成した時点で、**その後も原本を参照する必要があるドキュメントは `knowledge/ref/doc/` にコピーする**。コピー元（`input/` / `output/`）は使い捨て扱いに戻る。
- `ref/doc/` は「不変のソース」であり、**投入後は変更しない**（`SCHEMA.md` §2）。内容が更新された場合は新しいファイルとして追加し、日付等で世代を区別する。
- **判断基準**: Wiki 側の記述だけで意思決定を再現できるものはコピー不要。「なぜそう決めたか」が Wiki に落ちきらない一次情報（発注元の原文、議事録、レビュー指摘の全文など）はコピーする。

#### `ref/doc/` も Git 追跡外である点の帰結

`.gitignore` は `/knowledge/ref/` を除外しているため、**`ref/doc/` の「保持」はローカル作業ディレクトリ内での保持を意味し、リポジトリのクローンやマシン移行では引き継がれない**。個人情報を含む資料をコミットしない規約（`AGENTS.md` / `CLAUDE.md`）を優先した結果であり、この方針は維持する。

したがって:

- **`ref/doc/` を唯一の保管場所にしてよいのは、失われても再取得できる資料に限る**（発注元から再受領できる、`output/` から再生成できる等）。
- 失われると復元できない情報は、**機密を除去した上で `wiki/` 本文または `wiki/_assets/` に落とす**。`ref/doc/` に置いただけでは永続化していない。
- 別マシンへ移す場合は `input/` と同様、Git 以外の手段（バックアップ）で運ぶ必要がある。

## 2. 主対象ドメイン

本プロジェクトは**実装前の要件定義段階**のため、次の3つから始める。

1. **要件・仕様**（`wiki/requirements/`）— `output/claude_code_要件定義.md` を正典化する起点
2. **アーキテクチャ**（`wiki/architecture/`）— Cloudflare 構成、2パス AI 構成、無料枠制約
3. **データモデル**（`wiki/db/`）— 要件定義 §9 のテーブル群。規模が小さいので当面 1ファイルにまとめる

画面情報（`wiki/screens/`）は受け皿のみ用意し、資料が `input/` に入り次第起こす。

## 3. frontmatter の追加 type（この repo の上乗せ）

`requirement`（要件ページ）、`architecture`（構成ページ）、`db-domain`（テーブル群のドメインページ）、
`workflow`（業務フロー）、`decision`（採用/不採用の判断記録・ADR 相当）を追加採用。

元方針の `system`（1リポジトリ=1システムの実体ページ）は、本プロジェクトが単一リポジトリのため採用しない。

## 4. 一次情報の優先順位

1. `knowledge/wiki/` — **正典。要件・仕様に関する判断はここを参照する**
2. `knowledge/ref/doc/` — 保持された原本（§1.1）。Wiki の記述と食い違った場合、**どちらが新しいかを確認して Wiki を直す**
3. `input/` / `output/` — 未整理の生入力・生成物。Wiki 化されていないものだけが一次情報として意味を持つ
4. `wiki/_assets/` の一次資産

`ref/doc/` に保持している原本（2026-08-18 時点）:

| ファイル | 由来 | 内容 |
|---|---|---|
| `20260814_要求.md` | 発注元からの引き継ぎドキュメント | 元の要求。Wiki の変更点記述（`wiki/requirements/decisions.md`）の対照元 |
| `claude_code_要件定義_v1.5.md` | `output/` の生成物 | 正典化前の要件定義書全文。分割前の通し番号を確認する用途 |
| `要件定義codexレビュー_20260814.md` | レビュー指摘 | 指摘の全文。Wiki には結論のみが残るため原本を保持 |
| `codex_要件定義.md` | 別エージェントによる要件定義案 | 採用しなかった案。比較の経緯を保持 |
| `ai-ocr-demo.jsx` | プロトタイプ実装 v4 | UI・シードデータの実体。**要約不能なため保持必須** |

**実装開始後は `src/` のソースコード本体が最優先**に繰り上がり、上記は 2 番目以降に下がる。

## 5. 関連ルール

- コーディングスタイル・コミット / PR 規約は [`AGENTS.md`](../AGENTS.md)、Claude Code 向けの指示は [`CLAUDE.md`](../CLAUDE.md) を参照（この文書では再定義しない）。
- ワークスペース全体の規約は [`jv-it/CLAUDE.md`](../../../CLAUDE.md)。
- 機密（API キー・パスワード・トークン）は `wiki/` にも `input/` にも書かない。
- 顧客の実データ（実在の個人情報）は `wiki/` に持ち込まない（要件定義 NF-3-3 と同方針）。

## 6. 元方針（docs リポジトリ版）からの変更点

| 元の記述 | 本リポジトリでの扱い | 理由 |
|---|---|---|
| `/home/mizuho/projects/jv-it/ai-ocr` 配下の1リポジトリ | 本リポジトリ単体 | 単一プロジェクトのため |
| staging DB の実測（OD_data-Access 経由） | 対象外 | DB 未構築（実装前） |
| `inbox/` を新設し原本をコミット（B案） | 既存 `input/` を流用し、**Git 追跡外を維持** | `AGENTS.md` / `CLAUDE.md` の非コミット規約が優先 |
| `inbox/private/`（gitignore） | 不要 | `input/` 全体が追跡外のため |
| 旧 `docs/` / 旧 `openwiki/` の移設 | 該当なし | どちらも存在しない |
| OpenWiki（自動生成）の廃止 | 該当なし | 導入していない |
| 共有 DB 216テーブルのドメイン別分割 | 要件定義 §9 のテーブル群を当面1ファイル | 規模が小さいため |
| BackLog ミラー運用・push 制限 | 該当なし | 該当ルールなし |
| `SCHEMA.md` を参照 | `knowledge/SCHEMA.md` として作成済み | — |
| 一次資産の例（tableDetail.csv / openapi.json / IaC YAML） | 構成図・スキーマ定義等に読み替え | 該当ファイルが存在しない |

## 7. 未着手の作業

- [x] `SCHEMA.md`（OKF 規約本体）の作成
- [x] `wiki/` ディレクトリと `wiki/log.md` の初期化
- [x] **`ref/` と `input/` の役割分担の明文化**（§1.1。`input/` = 揮発の投入口、`knowledge/ref/doc/` = 恒久保持。`SCHEMA.md` §2 の記述も合わせて修正済み）
- [x] `output/claude_code_要件定義.md` の `wiki/requirements/` への正典化（2026-08-18。`wiki/requirements/` `wiki/architecture/` `wiki/db/` `wiki/screens/` へ分割）
- [x] `.gitignore` の `/output` 除外を継続（2026-08-19）。`output/` は生成物の揮発領域であり、正典は `wiki/`、保持が必要な原本は `knowledge/ref/doc/` に置くため、Git 追跡対象にする必要はない
- [x] **`wiki/` が Git 追跡対象であることの確認**（`git check-ignore` で検証済み: `knowledge/wiki/**` と `knowledge/OKF.md` / `SCHEMA.md` は TRACKABLE、`knowledge/ref/**` は IGNORED）
- [x] **プロジェクトルート直下の未追跡ファイルを再確認**（2026-08-19）。引継ぎ時に列挙されていた `.bashrc` `.zshrc` `.gitconfig` `.idea` `.vscode` `.mcp.json` 等は存在せず、`git status --short --untracked-files=all` にも出ないため追加対応なし。`.gitmodules` など将来の正規構成ファイルを誤って除外しないよう、予防的な ignore 追加は行わない
- [ ] `wiki/concepts/` `wiki/entities/` `wiki/synthesis/` `wiki/graph/` は未着手（要件定義からの正典化では起点となる資料がない）
