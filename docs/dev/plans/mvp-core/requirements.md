# mvp-core 要件定義書

## 概要

営業デモ用の単一テナントAI-OCR申請審査システム。職員（admin/staff）が画像を読み取り、AI業務チェック、名寄せ、承認、会員台帳管理までを行う。MVP 1.0（Gemini直結）を本線とし、同一契約でMVP 1.1（Document AI補助）へ差し替え可能にする。一般会員のログイン、基幹連携、メール自動送信は対象外である。[overview.md](../../../../knowledge/wiki/requirements/overview.md)

## 関連文書

- [user-stories.md](user-stories.md) / [acceptance-criteria.md](acceptance-criteria.md)
- [機能要件](../../../../knowledge/wiki/requirements/functional.md) / [非機能要件](../../../../knowledge/wiki/requirements/non-functional.md)
- [API](../../../../knowledge/wiki/architecture/api.md) / [共有型](../../../../knowledge/wiki/architecture/types.md) / [データモデル](../../../../knowledge/wiki/db/data-model.md)

## 用語

| 用語 | 定義 |
|---|---|
| 申請 | 1枚の原本画像から作成される台帳レコード |
| Pass①/② | OCR抽出／AI業務チェック |
| 名寄せ | 正規化・ルール候補抽出後のAI最終判定 |
| シード | リセットで保持する `isSeed=true` の初期データ |

## 機能要件（EARS）

### 普遍要件（SHALL）

- **FR-001 (F-1-1〜15)**: システムはメール＋パスワード認証、PBKDF2-SHA256ハッシュ、D1セッション、HTTPOnly/Secure/SameSite=Lax Cookie、サーバー側失効、admin/staff API認可、5回失敗時15分ロック、統一エラー文言、未ログイン画面リダイレクト、ログアウト、admin/staffシードを提供しなければならない。JWTをlocalStorageに保存してはならない。Basic認証を全資産・全APIの前段に適用し、アプリ認証を代替してはならない。Basic資格情報はシークレットで20文字以上のランダム値とし、README・ソース・ログに置いてはならない 🔵 *[functional.md F-1]*。関連: US-001, AC-001
- **FR-002 (F-2-1〜10)**: 画像（カメラ、選択、ドロップ）を1申請1枚で受け付け、クライアントで長辺1568px/JPEG品質85%へ変換し、帳票種別、全申請者項目（空欄を空文字）、0〜1確信度を抽出し、職員記入欄を除外し、段階進捗を表示し、完了時に受付申請とR2原本を保存しなければならない 🔵 *[functional.md F-2]*。関連: US-002, AC-002
- **FR-003 (F-2-11〜15)**: `gemini` は画像をGemini 3.1 Flash Liteへ、`document-ai-gemini` はDocument AIの必要なOCR情報＋元画像をGeminiへ渡し、共通JSON/API/保存形式を維持しなければならない。1.1のDocument AI失敗時は自動フォールバックせず再試行可能エラーとし、生レスポンス・全文OCRを永続化してはならない 🔵 *[functional.md F-2]*。関連: US-002, AC-003
- **FR-004 (F-3-1〜7)**: 業務チェックは整合性（error/warning）、必須不備、名寄せ、トリアージ（承認候補/要審査/差戻し候補と1〜2文の理由）、不備時のみ敬体200字以内の差戻し下書きを生成し、編集・コピー可能とし、ルールを定数化し、各結果をCheckRun履歴・最新結果として保存しなければならない 🔵 *[functional.md F-3]*。関連: US-003, AC-004
- **FR-005 (F-4-1〜12)**: `appStatus` と `triage` を分離し、受付→審査中→承認/差戻し、差戻し→審査中のみを許可し、承認から遷移不可とする。承認時pending会員をactive化し履歴化し、全変更（者・日時・前後・備考）を記録し、詳細の画像・項目編集、許可状態での再チェック（上限内）、候補再判断、AI/状態/処理者/紐付けフィルタ、「要審査のみ」ビューを提供しなければならない。競合は後着優先とする 🔵 *[functional.md F-4]*。関連: US-004, AC-005
- **FR-006 (F-5-1〜10)**: 会員の一覧・検索・登録・編集・状態変更・無効化、指定項目と4状態、正規化検索、申請・状態履歴、重複疑いビュー、5件の固定シード（仙臺 一郎を含む）を提供し、物理削除してはならない 🔵 *[functional.md F-5]*。関連: US-005, AC-006
- **FR-007 (F-6-1〜13)**: 正規化（旧字体、NFKC、かな、和暦、生年月日、電話）を決定的に行い、原文を保持して別カラム・索引化し、スコアで上位5件を抽出する。対応表はGit管理JSONとし、未登録文字を保持し、ルール段階ではAIを呼ばない。候補のみAIで高/中/低判定し、紐付け/別人/保留、判断者・日時を保存し、rejected候補を再提示してはならない 🔵 *[functional.md F-6]*。関連: US-006, AC-007
- **FR-008 (F-7-1〜2)**: adminのみスタッフの登録・編集・無効化を行え、staffからのAPIは403で拒否しなければならない 🔵 *[functional.md F-7]*。関連: US-007, AC-008
- **FR-009 (F-8-1〜9)**: 台帳をBOM付きUTF-8ワイドCSV（AI判定・理由・処理者、AIラベル列）で出力し、会員CSVはUTF-8/Shift_JISを受け付け、1回500件、新規のみ・会員番号重複スキップ、行エラーを集計表示し、同形式で出力しなければならない 🔵 *[functional.md F-8]*。関連: US-008, AC-009
- **FR-010 (F-9-1〜13)**: adminのみ、確認語と件数プレビュー後、機能有効設定時に申請・CheckRun・候補・申請履歴・非シード会員/履歴・R2原本を依存順で削除し、シード会員、職員、Tenant、Session、UsageCounterを保持し、件数・上限非回復を表示・ログ記録し、R2を1000件単位で処理しなければならない。無効時はAPI 404とする 🔵 *[functional.md F-9]*。関連: US-009, AC-010

### 非機能要件（SHALL / MUST NOT）

- **NFR-001 (NF-1-1〜4)**: OCRは1.0 15秒以内/1.1 20秒以内、業務チェック10秒以内、その他画面1秒以内を目標とし、待機中は進捗表示しなければならない 🔵。関連: US-002, US-003, AC-011
- **NFR-101 (NF-2-1〜9)**: WebCrypto PBKDF2自己記述形式（16バイト以上ソルト、保存反復回数で検証）、設定未指定/弱値規則、デモ20,000回、成功時再ハッシュを満たさなければならない 🔵。関連: US-001, AC-001
- **NFR-102 (NF-2-10〜17,23〜33,42〜45)**: 全画面/API認証、admin認可、会員ログインなし、AI鍵/Basic/Document AI秘密のサーバー限定、R2署名URL15分、HTTPS、ログ非露出、Static AssetsもWorker先行、AI Gateway予算上限・fail closed・Pass①②合算、Document AI最小権限、トークンはメモリのみ、ペイロードログ無効・メタデータ維持、Guardrails無効・標準課金を満たさなければならない 🔵。関連: US-001, US-002, AC-012
- **NFR-103 (NF-2-18〜22,34〜41)**: OCR 120枚/月、Gemini 720回/月、CheckRun 5回/申請を設定値で検証し、JST期間のUsageCounterを条件付き原子的UPDATEでAI前に加算し、上限時は呼び出さず、リセットで回復せず、テナント横断で保持し、引下げ超過もfail closed、リクエスト上書きを許してはならない 🔵。関連: US-003, US-009, AC-013
- **NFR-201 (NF-3-1〜3, NF-4-1〜7)**: 原本30日保持・個別削除、実在個人情報を投入しないこと、DBをリポジトリ層、AIをPipeline境界へ集約し、ルール/閾値（確信度85%）を一元化、対応表JSON、Pipeline/モデル/1.1設定を起動時検証しなければならない 🔵。関連: US-002, US-003, AC-014
- **NFR-301 (NF-5-1〜7,10〜22)**: tenantId供給源を1関数に限定し、入力値を信用せず、スコープ済みハンドルの全select/update/delete・JOIN・件数・CSV・R2に条件を強制し、単一Tenant起動検証、他テナント単一取得404、クロステナント全読取/更新/名寄せ統合試験、R2 `{tenantId}/`、会員番号テナント内採番を満たさなければならない。SQL検査NF-5-8/9とセッション解決はMVP対象外 🔵 *[tenant-isolation.md]*。関連: US-010, AC-015

## 制約・運用

- **CON-001 (OP-1〜15)**: Worker/D1/R2各1つの共有デモ環境、workers.dev、wranglerによる単一コマンド構築、固定Tenant、シード職員2/会員5、`isSeed`固定ID、商談前後リセット、実データ禁止、ローカル`wrangler dev`・remote CPU実測、1.0/1.1 Pipeline固定、1.1の月次ページ/請求監視とBilling予算アラート（自動停止ではない）に制約される 🔵 *[operations.md]*。関連: US-009, AC-016
- **CON-002**: 一般会員ログイン、予約/貸出本体、ルール編集画面、メール自動送信、基幹連携、顧客別環境・テナント切替、統計レポート、複数枚/両面は実装しない 🔵 *[overview.md]*。

## 実装方式の確定

- **DEC-001**: 原本画像は、Workerがアプリ内認可・テナントprefix検証後にR2 S3互換APIのGET署名URLを都度発行して配信する。URLは15分で失効し保存しない。`R2_ACCOUNT_ID` は通常の環境変数、`R2_S3_ACCESS_KEY_ID` / `R2_S3_SECRET_ACCESS_KEY` はWorkers Secretとする。🔵 関連: AC-002 / AC-012 / task 017。

## 要件IDの網羅性

F-1〜F-9、NF-1-1〜NF-5-22（文書で定義された枝番を含む）、OP-1〜15を上記のグループIDへ集約している。API契約は `architecture/api.md`、DTO・列は `architecture/types.md` と `db/data-model.md` を正典とする。

## 信頼性レベルサマリー

- 🔵 青信号: FR 10件、NFR 5件、CON 2件
- 🟡 黄信号: 0件
- 🔴 赤信号: 0件
