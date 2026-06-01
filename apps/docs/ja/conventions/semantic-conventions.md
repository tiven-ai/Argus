# Argus セマンティック規約

> 機械翻訳です。ネイティブによるレビュー待ち。

> **対象読者：** エージェントアプリを計装し、Argus に OpenTelemetry トレースを送る人すべて。

Argus は標準の OTLP/HTTP-JSON を受け付けます。OTel の標準属性に加え、Argus は各スパンの分類と UI での描画を制御する少数の `argus.*` 拡張属性を読み取ります。

## エンドポイント

```
POST /v1/traces Content-Type: application/json
```

ボディ：標準 OTLP `ExportTraceServiceRequest` の形を JSON でエンコードしたもの（[OTLP 仕様](https://github.com/open-telemetry/opentelemetry-proto)）。

成功したリクエストは `200 OK` を返し、ボディは `{ "accepted": <スパン数> }`。不正な形式または必須属性の欠落は `400` を返し、ボディに `error` と `issues` を含みます。

## Resource 属性

| 属性            | 必須               | 例                  | 備考                                          |
| --------------- | ------------------ | ------------------- | --------------------------------------------- |
| `argus.project` | **はい**           | `customer-bot`      | 初回利用時に自動作成。                        |
| `argus.service` | はい（または代替） | `intent-classifier` | 無い場合、Argus は `service.name` に代替。    |
| `service.name`  | 推奨               | `intent-classifier` | OTel 標準。`argus.service` の代替として使用。 |

## Span 属性 —— Argus 拡張

| 属性                   | 値                                                                                                 | 何を駆動するか                         |
| ---------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `argus.step.kind`      | `user_message`、`assistant_message`、`system_prompt`、`llm_call`、`tool_call`、`external_resource` | 左側のステップ一覧のアイコンとラベル。 |
| `argus.component.type` | `llm`、`skill`、`mcp`、`middleware`、`custom_tool`、`external_resource`                            | 右側の詳細レンダラー（M2 で実装）。    |
| `argus.component.name` | 自由文字列                                                                                         | 具体的なツール / skill / モデル名。    |

標準 OTel GenAI 属性（`gen_ai.system`、`gen_ai.request.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens` など）は保存・公開されますが、M1 ではまだ UI 駆動には使われません。

## Span event —— 構造化ペイロード

Argus は 3 つの名前付きスパン event を読み取ります。メッセージ・補完・エラーは大きな属性ではなくこれらに入れてください —— 属性にはキーごとのサイズ上限があり、event は完全な構造化ペイロードを運べます。

| Event 名       | 用途                                       | よく使う属性キー                                          |
| -------------- | ------------------------------------------ | --------------------------------------------------------- |
| `argus.input`  | このステップへの入力                       | `text`、`messages`、`tools`、`system_prompt`、`arguments` |
| `argus.output` | このステップの出力                         | `text`、`tool_calls`、`stop_reason`                       |
| `argus.error`  | エラー詳細（`status.code = ERROR` のとき） | `type`、`message`、`stack`                                |

## サンプルペイロード（curl）

リポジトリには `scripts/example-trace.json` が同梱されています —— 最小のシングルセッションペイロードです。次のように送ります：

```bash
curl -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json
```

その後 http://localhost:5173/sessions を開くと、生成されたセッションが見えます。

## 識別子のフォーマット

`traceId` と `spanId` は小文字 hex（それぞれ 32 / 16 文字）または base64（24 / 12 文字）で送れます。Argus は内部的に小文字 hex へ正規化します。

`startTimeUnixNano` と `endTimeUnixNano` は、エポックからの int64 ナノ秒の十進文字列です（OTLP-JSON 仕様）。Argus はミリ秒精度の UTC `Date` へ正規化します。

## マルチテナントに関する注記

Argus は M1 ではシングルテナントモード（`ARGUS_MODE=local`）で動作します。受け付けられたすべてのトレースは組み込みの `default` org に入ります。マルチテナント認証 + ingest token は M4 で提供されます。

## ステータス（M1）

本ドキュメントは M1 で実装済みの内容を扱います。進行中の項目：

- ステップ種別の分類は確定済み。追加は ADR プロセスに従います。
- `argus.component.type` の値は認識されますが、UI 描画は M2 です。
- `gen_ai.*` からの属性推論（例：`gen_ai.request.model` のみ設定時に `argus.step.kind = llm_call` を導出）は**未実装** —— クライアントは Argus 属性を明示的に設定してください。
