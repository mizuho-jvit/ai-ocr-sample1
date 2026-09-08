---
type: architecture
title: ログ・例外処理・可観測性設計
description: Cloudflare Workers無料枠で処理到達点と失敗箇所を追跡するための例外処理、構造化ログ、イベント予算、機微情報保護
tags: [ai-ocr, cloudflare-workers, observability, logging, error-handling, free-tier]
timestamp: 2026-08-28T00:00:00Z
---

# ログ・例外処理・可観測性設計

> 本ページは利用者レビューで追加された運用要件から導出した設計である。既存要件の識別子と衝突しないよう、本ページ独自の要件には LOG- 接頭辞を使用する。
>
> APIへ返すエラー形式は [APIエンドポイント仕様](./api.md#エラー)、ログへ出してはならない情報は [非機能要件](../requirements/non-functional.md)、採用判断は [判断記録 #19](../requirements/decisions.md#確定事項)を正とする。

## 目的

障害発生時に次の問いへ回答できることを目的とする。

1. どのリクエストで失敗したか。
2. どのコンポーネント・操作・処理段階まで進んだか。
3. 最後に正常完了した段階と、失敗した段階はどこか。
4. 利用者へどのHTTPステータスと安全なエラーコードを返したか。
5. 同じ種類の障害が何件発生しているか。

ログは業務データの保存先ではない。認証情報、個人情報、帳票、AIペイロード、SQL値を記録せずに上記を満たす。

## 無料枠の前提とイベント予算

2026-08-28時点の公式仕様を設計上の上限とする。

| 項目 | Workers Free |
|---|---:|
| Workerリクエスト | 100,000件/日 |
| Workers Logs | 200,000イベント/日 |
| 保存期間 | 3日 |
| 1リクエストのログデータ | 256KB |

出典:

- [Workers Logsの料金と制限](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Workers Freeのリクエスト・ログサイズ制限](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers料金表](https://developers.cloudflare.com/workers/platform/pricing/)

run_worker_first = true のため、APIだけでなく静的アセットの要求もWorkerリクエストへ含まれる。無料枠内に必ず収めるため、ログイベント数を次のように制限する。

| 種類 | 1リクエストあたり |
|---|---:|
| CloudflareのInvocation Log | 1件 |
| アプリケーションのカスタムログ | 最大1件 |
| 合計 | 最大2件 |

最悪時の計算は「100,000リクエスト × 2イベント = 200,000イベント/日」であり、Workers Logs無料枠の上限と一致する。

### イベント予算の規則

- 正常なHTTPリクエストではカスタムログを出さない。Invocation Logを成功記録として使用する。
- 1つの呼び出しで console 系APIに出す構造化イベントは最大1件とする。
- 失敗時は複数層でログを出さず、最上位境界で1件だけ出す。
- 通常の 400、401、403、404、409、422 はInvocation Logだけで追跡し、カスタムエラーイベントを出さない。
- 429、500、503、起動時検証失敗、D1・R2・AI障害はカスタムイベントの対象とする。
- デモリセットやシードなど低頻度の管理操作は、成功時にも1件の info を許可する。その呼び出しでは他のカスタムログを出さない。
- **例外（[決定#52](../requirements/decisions.md)）: デモリセットが②D1確定後に③R2削除で失敗した場合に限り、実行者・D1側の削除件数を1件の error として追加出力してよい（最上位境界の失敗ログと合わせて最大2件になる）。** D1の破壊的削除は既にコミット済みであり、この1件を省くと「誰が何件削除したか」が失われ監査できなくなるため、低頻度の管理操作というスコープに限定した予算超過を許容する。他の失敗経路（D1削除前の検証失敗・D1削除自体の失敗）には適用しない。
- Cron、Queue、Tail Workerを追加する場合は、その呼び出しもイベント予算へ加えて再計算する。
- デプロイ環境で debug ログは出さない。

## 要件

| ID | 要件 |
|---|---|
| LOG-1 | 外部I/Oを行う処理境界は、共通ラッパーを含む try/catch/finally の管理下で実行する |
| LOG-2 | 中間層のcatchは例外を正常値へ変換して処理を継続しない。安全な処理位置を付加した後、同じ例外またはcauseを保持した例外を必ず再throwする。最上位境界だけが1件のログ出力後に安全なエラー応答へ変換する |
| LOG-3 | finally は処理時間、最終完了段階、失敗段階、結果をリクエスト内のトレースへ確定する。D1接続のclose処理は行わない |
| LOG-4 | 最上位のWorker/Hono境界が、1リクエストにつき最大1件の構造化カスタムログを出す |
| LOG-5 | 正常リクエストはInvocation Logのみとし、開始・成功ログをアプリケーションから重複出力しない |
| LOG-6 | エラー応答には既存の安全なAPIエラーだけを返し、内部例外のmessage、stack、SQLを含めない |
| LOG-7 | ログは許可済みフィールドだけを受け付ける型付きAPIから出力し、任意オブジェクトの展開を禁止する |
| LOG-8 | Authorization、Cookie、パスワード、Secret、個人情報、帳票、AIペイロード、SQL、DB値をログへ含めない |
| LOG-9 | Workers Logsを明示的に有効化し、head sampling rateを1.0とする。Tracing、Logpush、外部OpenTelemetry出力はMVPで使用しない |
| LOG-10 | ログ保存期間は3日であるため、商談前後および障害発生から3日以内に確認する |
| LOG-11 | ログ出力失敗によって本来の業務例外を置き換えない。ログ処理は業務処理の成否を変更しない |
| LOG-12 | ログイベント数、機微情報の非出力、再throw、finally実行、エラー応答の秘匿を自動テストする |

## 例外処理の境界

次の境界は必ず try/catch/finally、または同じ動作を保証する共通ラッパーを通す。

| 境界 | try | catch | finally |
|---|---|---|---|
| Worker fetch | 設定読込、Tenant初期化、Hono呼出し | Honoより前の起動失敗を1件記録し、安全な500応答へ変換 | リクエスト結果と処理時間を確定 |
| Honoエラー境界 | route・middleware実行 | APIエラーへの変換と必要時の1件ログ | 応答ステータスと失敗段階を確定 |
| リポジトリ操作 | Drizzle・D1操作 | 操作・テーブル・段階を付加して再throw | 実行時間と影響件数をトレースへ反映 |
| R2操作 | put・get・delete・list | R2操作失敗として分類して再throw | 実行時間を反映 |
| AI・OCR Pipeline | 外部API呼出しと応答検証 | プロバイダー障害として分類して再throw | 呼出し段階と実行時間を反映 |
| シード・デモリセット | 段階的な一括処理 | 最後に完了した段階を保持して再throw | 成功・失敗と安全な件数を確定 |

try/catch/finally を各関数へ機械的に複製せず、共通の executeOperation 関数へ集約してもよい。ただし、上表のすべての処理がその管理下にあることをテストで証明する。

### 握り潰しの禁止

許可する catch は次の3種類だけとする。

1. 安全なコンテキストを付加して再throwする。
2. 仕様で回復可能と定義した競合を確認し、回復条件が成立した場合だけ正常終了する。
3. WorkerまたはHonoの最上位境界で1件のログを出し、安全なエラー応答へ変換して処理を終了する。

中間層では、回復条件が成立しなかった場合に必ず元の例外を再throwする。最上位境界を除き、ログを出した後に null、0、空配列、成功レスポンスへ置き換えてはならない。最上位境界の安全な4xx・5xx応答は成功値ではなく、例外処理の最終結果として扱う。

## 処理段階の追跡

開始・途中・終了をすべてログにすると無料枠を超えるため、処理段階はリクエスト中のメモリに保持し、失敗時の1件へまとめる。

    request.received
      → config.validated
      → tenant.initialized
      → auth.basic.validated
      → auth.session.validated
      → route.matched
      → service.validated
      → repository.executing
      → repository.completed
      → response.created

各操作は開始前に currentStage を設定し、成功後に lastCompletedStage を更新する。失敗ログには次を含める。

- failedStage: 例外発生時の currentStage
- lastCompletedStage: 直前に完了した段階
- component: worker、auth、repository、r2、ocr、ai など
- operation: tenant.initialize、members.select など、固定の許可値

入力値、レコードID、氏名、メールアドレスなどを段階名へ埋め込まない。

## 構造化ログのスキーマ

Cloudflareがフィールドを索引化できるよう、文字列化したJSONではなくオブジェクトを console.error、console.warn、console.info へ渡す。

| フィールド | 必須 | 内容 |
|---|---|---|
| schemaVersion | 必須 | 固定値 1 |
| event | 必須 | request.failed、request.rate_limited、admin.completed |
| level | 必須 | error、warn、info |
| occurredAt | 必須 | UTCのISO 8601 |
| requestId | 必須 | リクエスト単位の相関ID |
| cfRay | 任意 | Cloudflare Ray ID |
| component | 必須 | 固定のコンポーネント名 |
| operation | 必須 | 固定の操作名 |
| outcome | 必須 | failure、rejected、success |
| failedStage | 失敗時 | 失敗した段階 |
| lastCompletedStage | 失敗時 | 最後に完了した段階 |
| durationMs | 必須 | 処理時間 |
| httpMethod | HTTP時 | HTTPメソッド |
| routePattern | HTTP時 | 固定ルートパターン |
| httpStatus | HTTP時 | 応答ステータス |
| errorCode | 失敗時 | 安全な分類コード |
| errorType | 失敗時 | 許可リスト内の例外種別 |
| retryable | 任意 | 再試行可能性 |
| table | DB時 | 固定テーブル名 |
| affectedRows | 更新時 | 件数のみ |

### フィールド規則

- requestId はリクエストごとに生成し、同じ値を応答ヘッダー X-Request-Id に設定する。
- Cloudflare Ray IDを取得できる場合は cfRay に設定する。
- URL全体ではなくHonoの固定ルートパターンを routePattern に設定する。クエリ文字列は記録しない。
- operation、component、table はコードで定義した許可値だけを受け付ける。
- errorCode はアプリケーションの安全なエラーコードまたは内部分類コードを使う。
- 生の error.message はSQL、入力値、外部API本文を含む可能性があるため記録しない。
- stackはMVPのWorkers Logsへ保存しない。
- durationMs は performance.now の差分から算出する。
- affectedRows は件数だけを記録し、レコードの中身やIDを記録しない。

## エラー分類

| 内部分類 | HTTP | ログ | 例 |
|---|---:|---|---|
| CONFIG_INVALID | 500 | error | 必須設定不足、Tenant初期化失敗 |
| D1_OPERATION_FAILED | 500 | error | D1・Drizzleの取得・登録・更新・削除失敗 |
| R2_OPERATION_FAILED | 500/503 | error | 原本画像の保存・取得・削除失敗 |
| AI_UNAVAILABLE | 503 | error | Gemini、Document AIの障害 |
| USAGE_LIMIT_EXCEEDED | 429 | warn | 月次上限到達 |
| INTERNAL | 500 | error | 未分類の例外 |
| 通常の認証・入力・不存在 | 4xx | カスタムログなし | 401、403、404、409、422 |

内部分類はログ用であり、利用者へ返す既存のAPIエラーコードを不必要に増やさない。

## 出力禁止情報

- Authorization、Cookie、Set-Cookie
- Basic認証、アプリ内認証のユーザー名・メールアドレス・パスワード
- セッションID、CSRF token、署名付きURL
- APIキー、Access Key、Secret、OAuth token、サービスアカウント秘密鍵
- Tenant ID、StaffUser ID、Member ID、Application ID
- 氏名、住所、電話番号、郵便番号、生年月日
- 原本画像、base64、OCR全文、AIリクエスト・レスポンス
- SQL文、SQLパラメータ、D1行データ
- 生のリクエスト・レスポンスヘッダーおよび本文
- 生のErrorオブジェクト、error.message、stack

ログAPIは任意の連想配列を受け取らず、上記スキーマの明示フィールドだけを受け取る。console.error(error)、console.log(request)、任意オブジェクトのスプレッド展開は禁止する。

## Cloudflare設定

wrangler.toml へ次を明示する。

    [observability]
    enabled = true
    head_sampling_rate = 1.0

    [observability.logs]
    invocation_logs = true

### 採用しない機能

| 機能 | MVPでの扱い | 理由 |
|---|---|---|
| Workers Traces | 無効 | 将来ログと同じイベント枠を消費し、MVPでは処理段階の記録で代替できる |
| Workers Logpush | 使用しない | Workers Paid限定 |
| OpenTelemetry外部出力 | 使用しない | 無料プランの範囲外。外部の保管先と追加Secretも必要 |
| ローカルログファイル | 使用しない | Workersの書込可能領域は一時的なメモリ上の /tmp であり、永続ログにならない |

## 実装構成

想定する構成は次のとおり。

    src/worker/observability/
    ├── logger.ts
    ├── logger.test.ts
    ├── operation-trace.ts
    └── operation-trace.test.ts

- logger.ts: 型付きイベント、出力回数制御、レベル別のconsole出力
- operation-trace.ts: requestId、段階、処理時間、executeOperation
- index.ts: Worker・Hono最上位での1回だけのログ出力と安全な応答
- db/client.ts: D1操作をexecuteOperationへ通し、失敗位置を付加して再throw
- 将来のR2・OCR・AI実装も同じ境界を使用する

## テスト戦略

| テスト | 期待結果 |
|---|---|
| D1操作が失敗する | 例外が同一causeを保持して上位へ再throwされる |
| 操作中に例外が発生する | finallyが実行され、失敗段階と最終完了段階が確定する |
| Hono内で500が発生する | カスタムログ1件、安全な500応答1件 |
| Tenant初期化が失敗する | Hono外の境界からカスタムログ1件、安全な500応答1件 |
| 429が発生する | warnイベント1件、AIを呼び出さない |
| 通常の成功 | カスタムログ0件、Invocation Logのみ |
| 401、403、404、409、422 | カスタムログ0件 |
| 同一リクエストで複数層が失敗を捕捉する | console出力は合計1回だけ |
| エラーに秘密値・個人情報・SQLが含まれる | 出力イベントに含まれない |
| ログ出力処理自体が失敗する | 元の業務例外・HTTP応答を変更しない |

## 運用手順

無料版の保存期間は3日のため、次を運用ルールとする。

1. 商談前にWorkers Logsで直近の request.failed と request.rate_limited を確認する。
2. 商談終了直後に同じ確認を行う。
3. 障害報告では画面に返した X-Request-Id を記録する。
4. Workers Logsを requestId、event、errorCode、failedStage で絞り込む。
5. 障害発生から3日以内に原因を確認し、恒久対応をIssueまたは検証レポートへ残す。
6. 長期保存が必要になった時点でWorkers Paid、OpenTelemetry、Logpushを再検討する。MVPで独自のD1ログテーブルは作らない。

## 設計判断

### 正常時の開始・終了ログを出さない

処理の開始・終了を両方カスタムログにすると、Invocation Logを含めて最低3イベント/リクエストになり、Workers Freeの最大リクエスト数では30万イベント/日となる。無料枠20万イベント/日を超えるため採用しない。正常時はInvocation Log、失敗時は最後の1件へ処理段階を集約する。

### 下位層で直接ログを出さない

repository、service、route、Honoの各層が同じ例外を記録すると、無料枠を消費するだけでなく、1件の障害が複数件に見える。下位層は安全な処理位置を例外またはトレースへ付加して再throwし、最上位境界だけが出力する。

### finallyを接続解放には使用しない

D1 bindingはアプリケーションが接続をopen・closeする方式ではない。finallyは処理結果と到達段階を必ず確定するために使用する。将来、解放が必要な一時資源を導入した場合は同じfinallyで解放する。

## 関連ページ

- [システム構成](./cloudflare-stack.md)
- [APIエンドポイント仕様](./api.md)
- [非機能要件](../requirements/non-functional.md)
- [運用要件](../requirements/operations.md)
- [判断記録](../requirements/decisions.md)
