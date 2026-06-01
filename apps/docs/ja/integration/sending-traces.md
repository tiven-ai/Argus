# Argus へのトレース送信

> 機械翻訳です。ネイティブによるレビュー待ち。

> **対象読者：** AI エージェントアプリを初めて Argus に接続するエンジニア。
> **目標：** ゼロから、自分のセッションが UI に表示されるまで、約 10 分。

Argus は標準的な **OpenTelemetry** トレースを取り込みます。アプリがすでに OTel スパンをエクスポートしているなら、エクスポーターを Argus に向け、いくつかの `argus.*` 属性を加えるだけで、各スパンが適切な種類のステップとして描画されます。まだの場合でも、OTLP 対応のエクスポーターや OpenTelemetry Collector が使えます。

このページは**手順のウォークスルー**です。正確な属性契約（すべてのキー、許容されるすべての値）は [`semantic-conventions`](/ja/conventions/semantic-conventions) にあります —— そちらが信頼できる唯一の情報源で、本ガイドはデータを流し始めるのに必要な最小限だけを示します。

---

## 一覧

|                            |                                                                       |
| -------------------------- | --------------------------------------------------------------------- |
| **エンドポイント（HTTP）** | `POST /v1/traces` —— OTLP/HTTP-JSON、`Content-Type: application/json` |
| **エンドポイント（gRPC）** | 標準 OTLP/gRPC `TraceService/Export`                                  |
| **デフォルトポート**       | HTTP `4000`、gRPC `4317`（開発環境）                                  |
| **認証**                   | `Authorization: Bearer argus_…`（マルチテナントモードで必須）         |
| **ボディ**                 | 標準 OTLP `ExportTraceServiceRequest`                                 |
| **成功**                   | `200 OK` → `{ "accepted": <スパン数> }`                               |

---

## ステップ 1 —— ingest token を取得する

token は ingest を認証し、トレースが**どの project** に入るかを決めます。1 つの token はちょうど 1 つの project に属します。

**UI で：** サインイン → **Settings → Tokens → Create a new token**。project 名（初回利用時に自動作成）と token 名を入力します。完全な token は**一度だけ**表示されます —— 今すぐコピーしてください。以降は `argus_…` で始まる表示用の断片のみ保持されます。

token はこのような形です：

```
argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
```

> **ローカルモード。** サーバーが `ARGUS_MODE=local`（ローカル開発のシングルテナント既定値）で動作している場合、ingest に **token は不要** です —— すべてのトレースは組み込みの `default` org に入ります。以下の手順はそのまま使えます。`Authorization` ヘッダーを省略するだけです。token が必須なのは `multi-tenant` モードのみです。

---

## ステップ 2 —— エクスポーターを Argus に向ける

OpenTelemetry の **trace** エクスポーター（OTLP）を、Argus のエンドポイントと token で設定します。

**OTLP/HTTP**（推奨 —— 最も簡単で、下の curl と一致）：

```
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = http://localhost:4000/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS  = Authorization=Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = http/json
```

**OTLP/gRPC**（gRPC が好みの場合）：

```
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = http://localhost:4317
OTEL_EXPORTER_OTLP_TRACES_HEADERS  = Authorization=Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
```

> 一部の gRPC クライアント（ブラウザの gRPC-Web など）は `Authorization` メタデータを設定できません。Argus はフォールバックとして `x-argus-token: argus_…` メタデータキーでの token も受け付けます。

`localhost` とポートは、あなたのデプロイ先のホストに置き換えてください。Argus は素の OTLP を話すので、OpenTelemetry Collector の `otlphttp` / `otlp` エクスポーターも使えます —— パイプラインを上記エンドポイントに向けてください。

---

## ステップ 3 —— トレースを送る

パイプが通っているか確認する最速の方法は、同梱のサンプルペイロードです：

```bash
curl -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845' \
  --data-binary @scripts/example-trace.json
```

期待されるレスポンス：

```json
{ "accepted": 6 }
```

（`scripts/example-trace.json` は最小のシングルセッションペイロードで、Argus が期待する形のテンプレートとして最適です。ローカルモードでは `Authorization` ヘッダーを外してください。）

---

## ステップ 4 —— スパンに注釈を付けて、きれいに描画させる

Argus はあらゆる OTel トレースを受け付けますが、**セッションリプレイ**ビューはいくつかの `argus.*` 属性を中心に作られています。これらを設定すると、素のスパンがラベル付き・グループ化されたステップになります。

### Resource 属性（エクスポートごとに 1 回、`resource` に付与）

| 属性            | 必須               | 用途                                                     |
| --------------- | ------------------ | -------------------------------------------------------- |
| `argus.project` | **はい**           | セッションが属する project。初回利用時に自動作成。       |
| `argus.service` | はい（または代替） | 送信元サービス。無い場合は標準の `service.name` に代替。 |

### Span 属性（スパンごと）

| 属性                   | 何を駆動するか                                               |
| ---------------------- | ------------------------------------------------------------ |
| `argus.step.kind`      | ステップのアイコン/ラベル、およびラウンドへのグループ化。    |
| `argus.component.type` | 詳細レンダラー、および**「実行」タブのグループ化**（下記）。 |
| `argus.component.name` | ユーザーに表示される具体的なツール / skill / モデル名。      |

認識される値と完全なキー一覧は [`semantic-conventions`](/ja/conventions/semantic-conventions) にあります。要約：

- `argus.step.kind` ∈ `user_message`、`assistant_message`、`system_prompt`、`llm_call`、`tool_call`、`external_resource`
- `argus.component.type` ∈ `llm`、`skill`、`mcp`、`middleware`、`custom_tool`、`external_resource`

### ペイロードは属性ではなくスパン **event** に入れる

大きな内容（プロンプト、メッセージ、ツールの入出力、エラー）は属性ではなく、名前付きスパン event に入れます（属性にはキーごとのサイズ上限があります）：

| Event          | 運ぶもの（よく使うキー）                                     |
| -------------- | ------------------------------------------------------------ |
| `argus.input`  | `text`、`messages`、`tools`、`system_prompt`、`arguments`    |
| `argus.output` | `text`、`tool_calls`、`stop_reason`                          |
| `argus.error`  | `type`、`message`、`stack`（span status = ERROR のとき設定） |

### 「実行」タブを正しくグループ化する

ステップ詳細の**「実行」タブ**は、1 ラウンドで行われた呼び出しを 2 階層で表示します：

- `argus.component.type` が `external_resource` または `mcp` のとき、そのスパンは**「外部リソース呼び出し」**になります。その中で、`argus.component.name` のキーワード一致により**ナレッジベース / メモリ / データベース / HTTP / その他**へさらに分類されます（例：名前に `search`/`vector`/`rag` を含む → ナレッジベース、`sql`/`postgres`/`query` → データベース、`http`/`api`/`fetch` → HTTP、`memory`/`recall` → メモリ）。
- それ以外すべて（`custom_tool`、`skill`、`middleware`、または未設定）は**「内部ロジック」**になります。

つまり：プロセスの外に出る呼び出しには、`argus.component.type = external_resource`（または `mcp`）と説明的な `argus.component.name` を発行すれば、正しいリソース類別に振り分けられます。`argus.step.kind` が `tool_call` または `external_resource` の呼び出しが、そのラウンドの「実行」タブに表示されます。

---

## ステップ 5 —— 確認する

Argus UI（開発環境：<http://localhost:5173>）を開き、**Sessions** へ進みます。あなたのセッションは数秒以内にリストの先頭に現れます（リストも詳細ビューもライブストリーミングです）。クリックしてラウンドごとのリプレイを見て、**「実行」タブ**に切り替えて外部リソース呼び出しが期待どおりグループ化されているか確認します。

---

## 識別子と時刻のフォーマット

これらは OTLP 仕様に従います。多くの SDK が処理してくれますが、手動でペイロードを組む場合は：

- **`traceId` / `spanId`** —— 小文字 hex（32 / 16 文字）**または** base64。Argus は内部的に小文字 hex へ正規化します。
- **`startTimeUnixNano` / `endTimeUnixNano`** —— エポックからの int64 ナノ秒の十進**文字列**。内部でミリ秒精度の UTC へ正規化します。

---

## トラブルシューティング

| 症状                                                       | 考えられる原因                                                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 { "error": "unauthenticated" }`                       | マルチテナントモードで token が欠落/無効。`Authorization: Bearer argus_…` ヘッダーを確認。                                                                                               |
| `400 { "error": "invalid_otlp_payload", "issues": [...] }` | ボディが正しい OTLP でないか、必須属性（例：`argus.project`）が欠落。`issues` 配列が問題を示します。                                                                                     |
| `200 { "accepted": N }` だが UI に何も出ない               | project 違い（token の project を確認）、または `llm_call` スパンが無い —— リプレイは LLM 呼び出しを軸にラウンド化するため、`llm_call` スパンが 0 のセッションはラウンドを表示しません。 |
| スパンが生の JSON で表示され、ラベルが無い                 | そのスパンに `argus.step.kind` / `argus.component.type` が無い。                                                                                                                         |
| 外部呼び出しが「内部ロジック」に入った                     | `argus.component.type` が `external_resource`/`mcp` でないか、`argus.component.name` がリソースキーワードに一致しなかった。                                                              |

---

## リファレンス

- [`semantic-conventions`](/ja/conventions/semantic-conventions) —— 完全な属性契約（信頼できる情報源）。
- `scripts/example-trace.json` —— 最小でコピー可能なペイロード（リポジトリの `scripts/` ディレクトリ参照）。
- HTTP API の残り（sessions、tokens、auth）は英語版 API ドキュメントを参照。
