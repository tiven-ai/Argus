# 向 Argus 发送 trace

> **读者：** 第一次把 AI 智能体应用接入 Argus 的工程师。
> **目标：** 从零到在 UI 里看见自己的会话渲染出来，约 10 分钟。

Argus 接收标准的 **OpenTelemetry** trace。如果你的应用已经在导出 OTel span，只需把 exporter 指向 Argus，再加几个 `argus.*` 属性，每个 span 就会渲染成对应类型的步骤。如果还没有，任何支持 OTLP 的 exporter 或 OpenTelemetry Collector 都能用。

本页是**操作步骤**。完整的属性契约（每个键、每个可接受的值）见 [`semantic-conventions`](/zh/conventions/semantic-conventions) —— 那份参考是真源；本指南只展示让数据流起来所需的最小集。

---

## 速览

|                  |                                                                       |
| ---------------- | --------------------------------------------------------------------- |
| **端点（HTTP）** | `POST /v1/traces` —— OTLP/HTTP-JSON，`Content-Type: application/json` |
| **端点（gRPC）** | 标准 OTLP/gRPC `TraceService/Export`                                  |
| **默认端口**     | HTTP `4000`，gRPC `4317`（开发环境）                                  |
| **鉴权**         | `Authorization: Bearer argus_…`（多租户模式下必需）                   |
| **请求体**       | 标准 OTLP `ExportTraceServiceRequest`                                 |
| **成功**         | `200 OK` → `{ "accepted": <span 数> }`                                |

---

## 第 1 步 —— 获取 ingest token

token 用于鉴权 ingest，并决定 trace 落到**哪个 project**。一个 token 恰好归属一个 project。

**在 UI 里：** 登录 → **Settings → Tokens → Create a new token**。填一个 project 名（首次使用时自动创建）和一个 token 名。完整 token 只显示**一次** —— 现在就复制；之后只保留一个 `argus_…` 前缀的展示残段。

token 形如：

```
argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
```

> **本地模式。** 如果服务以 `ARGUS_MODE=local` 运行（本地开发的单租户默认值），ingest **不需要 token** —— 每条 trace 都落在内置的 `default` org 下。下面的步骤照样有效，只要省略 `Authorization` 头即可。只有 `multi-tenant` 模式才强制要求 token。

---

## 第 2 步 —— 把 exporter 指向 Argus

用 Argus 的端点和你的 token 配置 OpenTelemetry 的 **trace** exporter（OTLP）。

**OTLP/HTTP**（推荐 —— 最简单，与下面的 curl 一致）：

```
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = http://localhost:4000/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS  = Authorization=Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = http/json
```

**OTLP/gRPC**（如果你更偏好 gRPC）：

```
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = http://localhost:4317
OTEL_EXPORTER_OTLP_TRACES_HEADERS  = Authorization=Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
```

> 有些 gRPC 客户端（如浏览器的 gRPC-Web）无法设置 `Authorization` metadata。Argus 也接受把 token 放在 `x-argus-token: argus_…` metadata 键里作为兜底。

把 `localhost` 和端口换成你部署的主机。Argus 说的是原味 OTLP，所以 OpenTelemetry Collector 的 `otlphttp` / `otlp` exporter 同样可用 —— 把一条 pipeline 指向上面的端点即可。

---

## 第 3 步 —— 发送一条 trace

确认管道通不通，最快的办法是用自带的示例载荷：

```bash
curl -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845' \
  --data-binary @scripts/example-trace.json
```

期望响应：

```json
{ "accepted": 6 }
```

（`scripts/example-trace.json` 是一个最小的单会话载荷 —— 适合用作 Argus 期望形状的模板。本地模式下去掉 `Authorization` 头。）

---

## 第 4 步 —— 给 span 加注解，让它渲染得更好

Argus 接收任何 OTel trace，但**会话回放**视图是围绕几个 `argus.*` 属性构建的。设置它们，一个原始 span 就会变成带标签、分好组的步骤。

### Resource 属性（每次导出一次，挂在 `resource` 上）

| 属性            | 是否必需     | 用途                                            |
| --------------- | ------------ | ----------------------------------------------- |
| `argus.project` | **是**       | 会话归属的 project。首次使用时自动创建。        |
| `argus.service` | 是（或回退） | 发出方服务。缺失时回退到标准的 `service.name`。 |

### Span 属性（逐 span）

| 属性                   | 驱动什么                                           |
| ---------------------- | -------------------------------------------------- |
| `argus.step.kind`      | 步骤的图标/标签，以及它如何归入某一轮（round）。   |
| `argus.component.type` | 详情渲染器，以及**「执行」tab 的分组**（见下文）。 |
| `argus.component.name` | 展示给用户的具体工具 / skill / 模型名。            |

可识别的取值与完整键列表见 [`semantic-conventions`](/zh/conventions/semantic-conventions)。简版：

- `argus.step.kind` ∈ `user_message`、`assistant_message`、`system_prompt`、`llm_call`、`tool_call`、`external_resource`
- `argus.component.type` ∈ `llm`、`skill`、`mcp`、`middleware`、`custom_tool`、`external_resource`

### 载荷放在 span **event** 里，而不是属性里

大块内容（提示词、消息、工具输入输出、错误）应放进命名的 span event，而不是属性（属性有每键大小上限）：

| Event          | 携带（常见键）                                              |
| -------------- | ----------------------------------------------------------- |
| `argus.input`  | `text`、`messages`、`tools`、`system_prompt`、`arguments`   |
| `argus.output` | `text`、`tool_calls`、`stop_reason`                         |
| `argus.error`  | `type`、`message`、`stack`（当 span status = ERROR 时设置） |

### 让「执行」tab 正确分组

步骤详情的**「执行」tab** 分两级展示一轮里发生的调用：

- 当 `argus.component.type` 是 `external_resource` 或 `mcp` 时，该 span 归为**「调用外部资源」**。在此之下，再按 `argus.component.name` 的关键字匹配细分为**知识库 / 记忆 / 数据库 / HTTP / 其他**（例如名字含 `search`/`vector`/`rag` → 知识库；`sql`/`postgres`/`query` → 数据库；`http`/`api`/`fetch` → HTTP；`memory`/`recall` → 记忆）。
- 其余一切（`custom_tool`、`skill`、`middleware`，或未设置）归为**「程序内部逻辑」**。

所以：对离开你进程的调用，发出 `argus.component.type = external_resource`（或 `mcp`）并配一个有描述性的 `argus.component.name`，它们就会被分到正确的资源类目。`argus.step.kind` 为 `tool_call` 或 `external_resource` 的调用，会出现在所属轮次的「执行」tab 里。

---

## 第 5 步 —— 验证

打开 Argus UI（开发环境：<http://localhost:5173>），进入 **Sessions**。你的会话会在几秒内出现在列表顶部（列表和详情视图都是实时流式的）。点进去看逐轮回放；切到**「执行」tab** 确认你的外部资源调用如预期分了组。

---

## 标识符与时间格式

它们遵循 OTLP 规范；多数 SDK 会替你处理，但如果你手工构造载荷：

- **`traceId` / `spanId`** —— 小写 hex（32 / 16 字符）**或** base64。Argus 内部统一规范化为小写 hex。
- **`startTimeUnixNano` / `endTimeUnixNano`** —— 自纪元起 int64 纳秒数的十进制**字符串**。内部规范化为毫秒精度的 UTC。

---

## 排错

| 现象                                                       | 可能原因                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `401 { "error": "unauthenticated" }`                       | 多租户模式下 token 缺失/无效。检查 `Authorization: Bearer argus_…` 头。                                                             |
| `400 { "error": "invalid_otlp_payload", "issues": [...] }` | 请求体不是合法 OTLP，或缺少必需属性（如 `argus.project`）。`issues` 数组会指出问题。                                                |
| `200 { "accepted": N }` 但 UI 里什么都没有                 | project 不对（检查 token 的 project），或没有 `llm_call` span —— 回放围绕 LLM 调用分轮，零个 `llm_call` span 的会话不显示任何轮次。 |
| span 显示为原始 JSON、没有漂亮的标签                       | 该 span 上缺少 `argus.step.kind` / `argus.component.type`。                                                                         |
| 外部调用落进了「程序内部逻辑」                             | 它的 `argus.component.type` 不是 `external_resource`/`mcp`，或 `argus.component.name` 没命中任何资源关键字。                        |

---

## 参考

- [`semantic-conventions`](/zh/conventions/semantic-conventions) —— 完整的属性契约（真源）。
- `scripts/example-trace.json` —— 一个最小、可直接复制的载荷（见仓库 `scripts/` 目录）。
- HTTP API 的其余部分（sessions、tokens、auth）见英文 API 文档。
