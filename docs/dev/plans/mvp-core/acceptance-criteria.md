# mvp-core 受入基準

## 関連文書

- [requirements.md](requirements.md) / [user-stories.md](user-stories.md)

凡例: 🔵 正典に基づく確実な基準（🟡/🔴なし）。

## AC-001: [FR-001/NFR-101/US-001] 認証・認可 🔵

- Given Basic資格情報とアプリ認証情報が正しい When 静的資産/APIへアクセスする Then Basic通過後もアプリログインが必要で、成功時はD1セッションCookie、失敗時は統一401となる。
- Given 連続5回失敗 When 次のログインを行う Then 15分ロックされ、存在を推測できる差異を返さない。
- Given staff When admin APIを呼ぶ Then 403。Given未ログイン When 保護APIを呼ぶ Then 401。
- チェック: [ ] PBKDF2自己記述形式/再ハッシュ [ ] JWT localStorageなし [ ] Basic秘密の非露出 [ ] seed admin/staffログイン 🔵

## AC-002: [FR-002/US-002] 画像受付・保存 🔵

- Given JPEG/画像1枚 When 送信する Then 長辺1568px・品質85%で処理され、進捗が表示され、受付ApplicationとR2原本が保存される。
- Given 複数枚/両面/未対応画像 When 送信する Then エラーとなり未完成申請を作らない。読取完了後中断しても一覧に残る。
- チェック: [ ] 空欄を空文字で抽出 [ ] 職員欄除外 [ ] 画像署名URL15分 [ ] 30日保持/個別削除 🔵

## AC-003: [FR-003/US-002] Pipeline互換 🔵

- Given `gemini` When OCRする Then Geminiへ直接送る。Given `document-ai-gemini` When OCRする Then Document AI情報と元画像をGeminiへ送る。
- Given 1.1のDocument AI失敗 When OCRする Then Gemini単体へフォールバックせず再試行可能503。両版のAPI/画面/保存形式は同一で、生レスポンス/全文は保存しない。
- チェック: [ ] 未設定/未知モード起動失敗 [ ] 1.1設定不足起動失敗 [ ] APIキー/鍵/トークンがクライアント・ログ・D1・R2にない 🔵

## AC-004: [FR-004/US-003] 業務チェック 🔵

- Given 抽出済み申請 When チェックする Then 整合性、不備、候補、三択トリアージ、理由を返し、結果をCheckRunへ保存する。
- Given 不備/矛盾あり When 結果を表示する Then 敬体200字以内の編集可能な下書きが出る。任意空欄だけでは出ない。
- チェック: [ ] error/warning区分 [ ] 最新結果参照 [ ] 85%未満黄色 [ ] 10秒目標 🔵

## AC-005: [FR-005/US-004] 申請状態・編集 🔵

- Given 受付/審査中/差戻し When 許可された遷移・再チェックを行う Then履歴（者・日時・前後・備考）とCheckRunが増える。受付の再チェックは審査中へ遷移する。
- Given 承認済み When 遷移/再チェックする Then 409。承認時pending会員はactive化しStatusHistoryへ記録する。
- チェック: [ ] 一覧の全フィルタ [ ] 要審査ビュー [ ] 項目編集者記録 [ ] 後着優先 🔵

## AC-006: [FR-006/US-005] 会員管理 🔵

- Given 会員データ When 氏名/カナ/生年月日/電話/状態で検索する Then 部分一致・正規化一致で結果が返る。
- Given 会員を無効化する When 更新する Then inactiveとなり物理削除されず、状態・申請履歴が詳細に表示される。シード5件（仙臺 一郎）が投入される。

## AC-007: [FR-007/US-006] 名寄せ 🔵

- Given 「仙台一郎」申請 When 候補抽出する Then ルール段階で「仙臺 一郎」を含む上位5件以内となりAI判定が高になる。ルール段階でAIを呼ばない。
- Given 候補 When 紐付け/別人/保留する Then memberIdまたは判断・者・日時が保存され、rejected候補は再チェックで再提示されない。
- チェック: [ ] 旧字体/NFKC/かな/和暦/電話正規化 [ ] 原文不変 [ ] 未登録文字保持 [ ] 左右差分表示 🔵

## AC-008: [FR-008/US-007] スタッフ管理 🔵

- Given admin When CRUDする Then StaffUserが更新され監査列が残る。Given staff When 同APIを呼ぶ Then 403。

## AC-009: [FR-009/US-008] CSV 🔵

- Given 台帳 When exportする Then BOM付きUTF-8ワイド形式でAI判定・理由・処理者・原ラベル列を含む。
- Given UTF-8/Shift_JIS会員CSV（最大500行） When importする Then新規のみ登録し、会員番号重複とバリデーションエラーをスキップ集計表示する。会員exportは同形式。

## AC-010: [FR-010/US-009] リセット 🔵

- Given `ALLOW_DATA_RESET=true`のadmin When 件数確認後に確認語を入力して実行する Then対象レコード/R2が削除され、シード会員5件・職員・Tenant・Session・UsageCounterは保持される。
- Given staff、確認語不一致、設定無効 When 実行する Then 403/422/404となり削除しない。実行者・日時・件数をログへ出し、画面に上限非回復を表示する。
- チェック: [ ] D1子→親→R2順 [ ] R2 1000件分割 [ ] 複数回リセットで同じ初期状態 🔵

## AC-011: [NFR-001/US-002/US-003] 性能 🔵

- **関連**: NFR-001, US-002, US-003
- [ ] OCR 1.0 ≤15秒 [ ] OCR 1.1 ≤20秒 [ ] 業務チェック ≤10秒 [ ] 通常画面 ≤1秒 [ ] 待機進捗表示

## AC-012: [NFR-102] 出力・Gateway保護 🔵

- **関連**: NFR-102, US-001, US-002
- [ ] AI Gateway予算超過時は呼び出さずエラー [ ] payloadログなし・メタデータあり [ ] Guardrails無効/標準課金 [ ] Workers AI使用量増加なし
- [ ] 原本は署名URLのみ [ ] Basic Authorization/AI秘密/原本本文をログ・応答へ出さない

> DEC-001により、Workerがアプリ内認可後にR2 S3互換APIのGET署名URLを都度発行する。URLを保存せず、失効時は同じAPIから再取得する。🔵

## AC-013: [NFR-103/US-003/US-009] 利用量上限 🔵

- **関連**: NFR-103, US-003, US-009
- [ ] OCR120/月・Gemini720/月・CheckRun5/申請 [ ] 未設定・0・負・小数・未知値で起動失敗 [ ] 条件付きUPDATEをAI前に実施
- [ ] 上限時429でAI未実行 [ ] JST期間切替 [ ] リセットでUsageCounter不変 [ ] 上限引下げ超過は即fail closed [ ] リクエスト上書き不可

## AC-014: [NFR-201] 保守・運用制約 🔵

- **関連**: NFR-201, US-002, US-003, US-009
- [ ] DBクエリはリポジトリ層のみ [ ] AIはPipeline境界のみ [ ] ルール/閾値/対応表を一元管理 [ ] env未設定を起動拒否
- [ ] 実在個人情報を投入しない旨をREADME/手順へ記載 [ ] remoteでPBKDF2 CPUを実測

## AC-015: [NFR-301/US-006/US-010] テナント分離 🔵

- **関連**: NFR-301, US-006, US-010
- Given A/Bの2テナントデータ、`TENANT_ID=A` When 全読取・集計・CSV・名寄せ・画像取得を行う Then Bを含めない。BのID取得は404、更新/削除は失敗し無変更。
- [ ] 全テーブルtenantId NOT NULL [ ] input tenantId無視 [ ] 全JOIN/索引/採番/R2 prefixに条件 [ ] エンドポイント一覧突合テスト
- [ ] TENANT_ID未設定/不存在/複数Tenantで起動失敗（分離試験時を除く） [ ] SQL検査・セッション解決はMVP対象外

## AC-016: [CON-001/US-009] デモ運用 🔵

- **関連**: CON-001, US-009
- [ ] Worker/D1/R2各1つ・workers.dev [ ] 単一コマンド構築 [ ] seed職員2/会員5、固定ID・isSeed=true [ ] 商談前後F-9 [ ] 1.0/1.1モード固定 [ ] 1.1月次請求/無料枠を監視

## 信頼性レベルサマリー

- 🔵: 16件 (100%) / 🟡: 0件 / 🔴: 0件
