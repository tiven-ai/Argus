# Argus 语义约定

> **读者：** 任何要为智能体应用埋点、向 Argus 发送 OpenTelemetry trace 的人。

Argus 接收标准的 OTLP/HTTP-JSON。在 OTel 标准属性之上，Argus 读取一小组 `argus.*` 扩展属性，用来控制每个 span 如何被分类并在 UI 中渲染。

## 端点

```
POST /v1/traces Content-Type: application/json
```

请求体：标准 OTLP `ExportTraceServiceRequest` 形状，以 JSON 编码（[OTLP 规范](https://github.com/open-telemetry/opentelemetry-proto)）。

成功的请求返回 `200 OK`，体为 `{ "accepted": <span 数> }`。格式错误或缺少必需属性返回 `400`，体含 `error` 与 `issues`。

## Resource 属性

| 属性            | 是否必需     | 示例                | 说明                                       |
| --------------- | ------------ | ------------------- | ------------------------------------------ |
| `argus.project` | **是**       | `customer-bot`      | 首次使用时自动创建。                       |
| `argus.service` | 是（或回退） | `intent-classifier` | 缺失时，Argus 回退到 `service.name`。      |
| `service.name`  | 推荐         | `intent-classifier` | OTel 标准。用作 `argus.service` 的回退值。 |

## Span 属性 —— Argus 扩展

| 属性                   | 取值                                                                                               | 驱动什么                      |
| ---------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- |
| `argus.step.kind`      | `user_message`、`assistant_message`、`system_prompt`、`llm_call`、`tool_call`、`external_resource` | 左侧步骤列表的图标与标签。    |
| `argus.component.type` | `llm`、`skill`、`mcp`、`middleware`、`custom_tool`、`external_resource`                            | 右侧详情渲染器（M2 落地）。   |
| `argus.component.name` | 自由字符串                                                                                         | 具体的工具 / skill / 模型名。 |

标准 OTel GenAI 属性（`gen_ai.system`、`gen_ai.request.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens` 等）会被存储和暴露，但在 M1 尚未用于驱动 UI。

## Span event —— 结构化载荷

Argus 读取三个命名的 span event。消息、补全和错误请用它们承载，而不是大属性 —— 属性有每键大小上限，event 能携带完整的结构化载荷。

| Event 名       | 用途                                 | 常见属性键                                                |
| -------------- | ------------------------------------ | --------------------------------------------------------- |
| `argus.input`  | 喂给该步骤的输入                     | `text`、`messages`、`tools`、`system_prompt`、`arguments` |
| `argus.output` | 该步骤产出的输出                     | `text`、`tool_calls`、`stop_reason`                       |
| `argus.error`  | 错误详情（当 `status.code = ERROR`） | `type`、`message`、`stack`                                |

## 示例载荷（curl）

仓库自带 `scripts/example-trace.json` —— 一个最小的单会话载荷。这样发送：

```bash
curl -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json
```

然后浏览 http://localhost:5173/sessions 即可看到生成的会话。

## 标识符格式

`traceId` 与 `spanId` 可以用小写 hex（分别 32 / 16 字符）或 base64（24 / 12 字符）发送。Argus 内部统一规范化为小写 hex。

`startTimeUnixNano` 与 `endTimeUnixNano` 是自纪元起 int64 纳秒数的十进制字符串（OTLP-JSON 规范）。Argus 规范化为毫秒精度的 UTC `Date`。

## 多租户说明

Argus 在 M1 以单租户模式运行（`ARGUS_MODE=local`）。每条被接收的 trace 都落在内置的 `default` org 下。多租户鉴权 + ingest token 在 M4 交付。

## 状态（M1）

本文涵盖 M1 已实现的内容。仍在进行中的项：

- 步骤类型分类法已定稿；新增走 ADR 流程。
- `argus.component.type` 的取值已被识别，但 UI 渲染在 M2。
- 从 `gen_ai.*` 推断属性（例如仅设置了 `gen_ai.request.model` 时推导出 `argus.step.kind = llm_call`）**尚未**实现 —— 客户端应显式设置 Argus 属性。
