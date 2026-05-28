# Argus — 设计文档

> Argus 是 AI Agent 程序的观测系统。希腊神话里 Argus 是百眼巨人，专司"看着一切"。本项目目标：观测 Agent 会话的每一步执行——提示词、模型调用、工具调用、内部组件（Skill / MCP / Middleware / 自定义 Tool）、外部资源（DB / HTTP / Redis 等），并以"按执行步骤逐步观察"的方式呈现给用户。

- **状态**：设计已对齐，待进入实现计划阶段
- **作者**：Argus team
- **创建日期**：2026-05-28

---

## 1. 项目目标

### 1.1 核心创意
按执行步骤逐步观察一个 Agent 会话过程中每一步的动作和结果。

### 1.2 三类使用场景
1. **开发者调试单次会话** —— 实时/回放查看每一步的输入输出，是 MVP 主要价值。
2. **生产环境运维监控** —— 关注延迟、错误率、Token 消耗、聚合指标，可下钻到具体会话。
3. **业务/产品分析** —— 用户提问分布、Agent 完成率、典型失败案例。

> MVP 优先做 #1，但架构上为 #2 / #3 预留扩展点。

### 1.3 部署形态
- **私有部署**（企业 K8s/VM）
- **公云 SaaS**（多租户）
- 架构上从一开始就支持 multi-tenant 与水平扩展，但 MVP 落到单进程 + 单库的轻部署。

### 1.4 关键非目标 (Non-Goals)
- 指标 (metrics) / 日志 (logs) 接收（仅做 traces）
- 告警 / 趋势图（M0–M6 不做）
- SSO / OIDC（用户名密码 + 邮箱验证足够）
- 跨会话对比 / 业务分析仪表盘
- Skill/MCP/Middleware/自定义 Tool/外部资源 之外的组件类型
- ClickHouse 后端（架构预留，实现先 PG）
- Helm chart / K8s 部署文档

---

## 2. 整体架构

### 2.1 进程模型（MVP）

单 Node 进程，内部四个模块边界清晰。

```
┌─────────────────────────── Argus Server (Node) ───────────────────────────┐
│                                                                            │
│   [ingest]            [storage]             [pubsub]           [api]       │
│   OTLP HTTP/gRPC  →   StorageBackend  ←──┐  MessageBus  ←───  REST + SSE   │
│   receiver            (PG impl)          │  (in-proc impl)                  │
│                        │                 │                                  │
│                        └─→ 写完 emit ────┘                                  │
└────────────────────────────────────────────────────────────────────────────┘
        ↑                                                              ↓
    Agent SDK / OTel Collector                                  Browser (React)
    (任意客户端，OTLP 标准)                                       (Vite, shadcn/ui)
```

### 2.2 可替换的核心接口

| 接口            | MVP 实现                        | 未来可替换            |
| --------------- | ------------------------------- | --------------------- |
| `StorageBackend`| PostgreSQL + JSONB + 时间分区表 | ClickHouse            |
| `MessageBus`    | 进程内 EventEmitter             | Redis pub/sub         |
| `AuthProvider`  | 本地用户 + bcrypt + JWT cookie  | OIDC / SAML           |

抽象层是从一开始就要写的"轻骨架"，约比内联实现多 ~15% 代码量。

### 2.3 外部依赖（MVP）
- PostgreSQL 15+
- Node 20 LTS+
- **不引入** Redis、ClickHouse、消息队列、对象存储

---

## 3. 数据模型与语义约定

### 3.1 分层方案

```
接收层 (OTLP 标准)
  └─ Trace = 一次 Agent 会话 (OTel trace_id)
     └─ Span = 一个执行步骤 (OTel span_id, parent_span_id)
        ├─ 标准属性: 沿用 OTel GenAI Semantic Conventions
        │    (gen_ai.system, gen_ai.request.model, gen_ai.usage.*, ...)
        └─ Argus 扩展属性: argus.* 前缀
             ├─ argus.step.kind       // 主分类（决定左侧步骤图标）
             ├─ argus.component.type  // 组件分类（决定右侧 renderer）
             └─ argus.component.name  // 具体名称
```

### 3.2 枚举定义

**`argus.step.kind`**（左侧步骤列表的图标/标签来源）：
- `user_message` — 用户消息
- `assistant_message` — 助手回复
- `system_prompt` — 系统提示词
- `llm_call` — 单次模型推理本身
- `tool_call` — 工具调用（包含 tool_result）
- `external_resource` — 外部资源调用（DB / HTTP / Redis 等）

**`argus.component.type`**（右侧详情渲染器分支）：
- `llm` — LLM 调用
- `skill` — Skill 类型
- `mcp` — MCP server 工具
- `middleware` — 中间件
- `custom_tool` — 程序自定义 tool
- `external_resource` — 外部资源

### 3.3 结构化 payload 用 Span Events

Span attributes 有 4KB 软上限，不适合塞大对象（messages 数组、tools 定义、completion 文本）。Argus 把结构化 payload 走 Span Events：

- `argus.input` event：`messages[]`、`tools[]`、`system_prompt`、参数等
- `argus.output` event：`text`、`tool_calls[]`、`stop_reason` 等
- `argus.error` event：异常信息

前端拿到的是已经分类好的 `Step` 对象，可路由到对应渲染器，不是 raw JSON dump。

### 3.4 多租户层级

```
Organization                    // 组织
  └─ Project        (例: "客服Agent")
     └─ Service     (例: "intent-classifier"，一个 agent app)
        └─ Session  (= Trace, 一次会话)
           └─ Step  (= Span, 单步)
```

客户端发 OTLP 时通过 resource attributes 指定 `argus.project` / `argus.service`，并用 `Authorization: Bearer <IngestToken>` 区分租户。

### 3.5 接入指南（DX）

MVP 提供：
1. **`docs/conventions/semantic-conventions.md`** —— 客户端开发者唯一要读的接入规范，含完整属性表与示例。
2. **接入示例** —— 至少覆盖 Claude Agent SDK (Node) 与 LangChain 两类客户端。
3. **可选 `@argus/sdk-node`** —— 一个薄包装，自动按 Argus 约定打属性。客户端不强制使用。

---

## 4. 采集与实时推送链路

### 4.1 写入链路

```
Client (OTel SDK)
    │  OTLP/HTTP (POST /v1/traces) 或 OTLP/gRPC (:4317)
    │  Resource attributes: argus.project, argus.service
    │  Header: Authorization: Bearer <IngestToken>
    ▼
┌─ Receiver ──────────────────────────────────────────────────┐
│ 1. 复用 @opentelemetry/otlp-transformer 解码 protobuf         │
│ 2. 按 IngestToken → 解析出 {orgId, projectId, serviceId}     │
│ 3. 把每个 ResourceSpan 拆成 Step[] (Argus 内部模型)          │
│ 4. 入队 (in-memory bounded queue, backpressure friendly)     │
└──────────────────┬─────────────────────────────────────────┘
                   ▼
┌─ Writer (worker) ──────────────────────────────────────────┐
│ 1. 批量写 PG (INSERT ... 每批 ~200 行)                     │
│ 2. 写成功 → MessageBus.publish('session:'+id, step)        │
│ 3. 失败 → 重试 3 次 → 丢死信表 + 日志                      │
└──────────────────┬─────────────────────────────────────────┘
                   ▼
┌─ Pusher ────────────────────────────────────────────────────┐
│ - SSE: GET /api/sessions/:id/stream (订阅 session 增量)    │
│ - 心跳 15s, 自动重连 (Last-Event-ID 续传)                  │
│ - 同时支持 "先回放历史 + 切到实时" 模式                     │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 协议细节

**"先回放 + 切实时" 客户端协议：**

1. 前端打开会话页 → `GET /api/sessions/:id`（拉历史 steps，分页）
2. 同时建立 `GET /api/sessions/:id/stream`（SSE）
3. SSE 第一条事件携带 `since_step_id`，前端用它去重
4. 之后所有新 step 通过 SSE 推送
5. 如果会话已结束，SSE 立刻发送 `{type: 'completed'}` 并关闭

### 4.3 SSE 而非 WebSocket

- 单向推送够用，浏览器不需要往服务端发实时指令
- 走 HTTP，更容易过代理、自动重连、断点续传（`Last-Event-ID`）
- 实现轻、无需额外依赖

### 4.4 背压与限流

- 单 SSE 连接最高 200 events/秒，超过则合并下发（buffer 100ms 内的 step 一并发）
- 单 session 累计 step 超 10000 时，前端切到 "仅历史 + 轮询" 兜底模式

### 4.5 接收器入口

- OTLP/HTTP (`POST /v1/traces`)：Fastify 路由
- OTLP/gRPC (`:4317`)：Fastify gRPC plugin 或独立的 grpc-js server

---

## 5. 前端架构

### 5.1 技术栈

| 关注点         | 选择                              | 备注                                          |
| -------------- | --------------------------------- | --------------------------------------------- |
| 构建           | Vite + React 19 + TypeScript strict | 标准                                          |
| UI 组件        | shadcn/ui + Tailwind v4           | 用户要求；Unifi Console 风格待 DESIGN.md      |
| 路由           | TanStack Router                   | 文件式 + search params 类型安全               |
| 服务端状态     | TanStack Query v5                 | 缓存、去重、SSE 整合                          |
| 客户端状态     | Zustand（仅必要时）               | 大部分状态在 URL 或 TanStack Query 里         |
| 表单           | React Hook Form + Zod             | 前后端共享 Zod schema                         |
| 虚拟列表       | @tanstack/react-virtual           | 会话步骤可能上万条                            |
| 图标           | lucide-react                      | shadcn 标配                                   |
| 主题           | shadcn 亮/暗双模式，**默认亮色**   |                                               |
| i18n           | i18next + react-i18next           | 默认 `en`，支持 `zh-CN`、`ja`                 |

### 5.2 关键页面结构

```
/login                                            登录
/signup                                           公网注册
/orgs/:orgId                                      组织首页 (项目列表)
/orgs/:orgId/projects/:pid                        项目首页 (服务、会话搜索、最近会话)
/orgs/:orgId/projects/:pid/sessions/:sid          ★ 会话回放页 (核心)
/orgs/:orgId/settings/*                           成员/Token/集成
```

### 5.3 会话回放页布局

```
┌──────────────────────────────────────────────────────────────┐
│ Topbar: 会话标题 · 状态徽章 · 总耗时 · Token · 实时/历史指示  │
├──────────────────────┬───────────────────────────────────────┤
│                      │                                       │
│  StepTimeline        │  StepDetail                           │
│  (左侧, 虚拟列表)    │  (右侧, 结构化渲染)                   │
│                      │                                       │
│  ▸ system_prompt    │  [Input | Output | Raw | Events]      │
│  ▸ user_message     │                                       │
│  ▸ llm_call         │  根据 step.kind 路由到不同 Renderer:  │
│  ▸ tool_call ✓      │  - UserMessageRenderer                │
│  ▸ assistant_msg    │  - AssistantMessageRenderer           │
│  ...                │  - LlmCallRenderer                    │
│                      │  - ToolCallRenderer                   │
│  ↓ 实时新步骤滚入    │  - ExternalResourceRenderer           │
│                      │  - GenericJsonRenderer (fallback)     │
└──────────────────────┴───────────────────────────────────────┘
```

### 5.4 Renderer 注册机制

```ts
interface StepRenderer {
  id: string
  match: (step: Step) => number  // 0=不匹配, 1+=匹配优先级
  Component: React.FC<{ step: Step }>
}

registerRenderer(LlmCallRenderer)
registerRenderer(ToolCallRenderer)
registerRenderer(GenericJsonRenderer)  // fallback, priority=0
```

新增 step 类型只需注册新 renderer，不动核心。

### 5.5 SSE 集成

自定义 `useSessionStream(sessionId)` hook：
- 先 `GET /api/sessions/:id` 拉历史
- 自动建立 SSE 接增量
- 自动去重（`since_step_id`）
- TanStack Query cache 作为单一数据源
- 自动重连（`Last-Event-ID`）

### 5.6 国际化

- 默认 `en`
- 支持 `zh-CN`、`ja`
- 字符串集中在 `apps/web/src/locales/{lang}/common.json`
- 以 `en` 作为单一事实源，CI 校验其他语言无缺失 key
- 语言切换器在用户菜单

---

## 6. 多租户、鉴权与隔离

### 6.1 实体层级

```
User ─┬─ (member_of) ── Organization ── Project ── Service
      │                       │
      └─ Role: owner/admin/member (per-org)
                              │
                              └─ IngestToken (per-project, 可多个)
```

### 6.2 两类访问通道

| 通道                        | 谁用                  | 凭据                              | 中间件                                              |
| --------------------------- | --------------------- | --------------------------------- | --------------------------------------------------- |
| **Ingest API**              | Agent / OTel SDK      | `IngestToken` (per-project)       | `ingestAuth`: token → `{orgId, projectId, serviceId}` |
| **Query/UI API (REST + SSE)** | 浏览器用户            | 登录 cookie (HTTP-only) + CSRF    | `sessionAuth`: cookie → `{userId, currentOrgId}`    |

两套 token 物理隔离，泄露 Ingest token 不会影响用户登录。

### 6.3 注册与登录

- **公网注册**：邮箱 + 密码 + 邮箱验证（M4 一并交付，公网部署默认开启，本地模式可关闭）
- 用户注册即获得一个个人 Organization (`{username}'s workspace`)
- 用户名密码：bcrypt + 短时效 JWT 存 HTTP-only cookie
- **不做 SSO / OIDC**（Non-Goals）

### 6.4 数据隔离

- 所有查询强制带 `orgId` 谓词
- DAO 层封装 `withTenant(orgId, fn)` helper，业务代码不直接拼接
- PG **row-level security (RLS)** 作为兜底——即使应用层漏写，DB 也拒绝跨租户查询

### 6.5 Single-tenant / Local 模式

- 配置 `ARGUS_MODE=local`：跳过登录，自动作为 `default-org` 的 owner 进入
- 用于开发者本地工具，零配置启动
- 同一份代码，靠环境变量切换

### 6.6 审计日志（最小版）

- 仅记录敏感事件：登录、token 创建/吊销、成员变更、数据删除
- 写到独立 `audit_log` 表，不进 trace 数据库
- 不做全链路操作审计（Non-Goals）

---

## 7. 项目工程化

### 7.1 Monorepo 结构

```
argus/
├── apps/
│   ├── server/                 # Node 后端 (Fastify + Kysely + PG)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── ingest/     # OTLP HTTP + gRPC receivers
│   │   │   │   ├── storage/    # StorageBackend 接口 + PG impl
│   │   │   │   ├── pubsub/     # MessageBus 接口 + in-proc impl
│   │   │   │   ├── api/        # REST + SSE
│   │   │   │   └── auth/       # AuthProvider + middleware
│   │   │   ├── db/
│   │   │   │   ├── migrations/ # kysely-migrator
│   │   │   │   └── schema.ts   # 由 kysely-codegen 生成
│   │   │   └── main.ts
│   │   └── test/
│   └── web/                    # React 前端 (Vite)
│       └── src/
│           ├── routes/         # TanStack Router 文件式路由
│           ├── features/       # 按业务领域切分
│           │   ├── session-replay/
│           │   ├── projects/
│           │   └── auth/
│           ├── components/ui/  # shadcn 原子组件
│           ├── lib/            # api client、SSE hook
│           └── locales/        # i18n
├── packages/
│   ├── shared-types/           # 前后端共享 TS 类型 (Zod schemas)
│   ├── sdk-node/               # 可选的 @argus/sdk-node 薄包装
│   └── eslint-config/          # 共享 lint 配置
├── docs/
│   ├── superpowers/
│   │   ├── specs/              # brainstorming 输出
│   │   └── plans/              # writing-plans 输出
│   ├── architecture/           # C4 图、整体架构 (长期文档)
│   ├── adr/                    # Architecture Decision Records
│   ├── conventions/
│   │   ├── semantic-conventions.md  # ★ 客户端开发者必读
│   │   ├── coding-style.md
│   │   └── git-workflow.md
│   ├── api/                    # OpenAPI + SSE 协议手册
│   └── design/                 # DESIGN.md + UI style guide
├── infra/
│   ├── docker/                 # Dockerfile + compose
│   └── k8s/                    # 未来 Helm chart
├── scripts/                    # 本地开发与 CI 辅助脚本
├── .github/workflows/          # CI
├── pnpm-workspace.yaml
├── turbo.json
├── README.md                   # 5 分钟启动
├── CLAUDE.md                   # 给 AI 协作者的项目说明
└── CONTRIBUTING.md             # 给人类协作者的开发流程
```

### 7.2 工具链选型

| 维度        | 选择                                                                     |
| ----------- | ------------------------------------------------------------------------ |
| 包管理      | `pnpm` (workspaces)                                                      |
| 构建编排    | `Turborepo`（本地与 CI 增量缓存）                                        |
| Node        | 20 LTS+                                                                  |
| 语言        | TypeScript strict 模式，全栈                                             |
| 后端框架    | **Fastify v5**（高吞吐 + 内置 schema validation + plugin 生态）          |
| 数据访问    | **Kysely** + `kysely-codegen` + `kysely-migrator`（类型安全 SQL builder）|
| 校验        | Zod（前后端共享 schema）                                                 |
| 测试运行器  | **Vitest**（框架无关，Jest API 兼容；前后端共用）                        |
| 集成测试    | testcontainers-node（真 PG）                                             |
| E2E         | Playwright                                                               |
| Lint/Format | ESLint flat config + Prettier                                            |
| Git hooks   | husky + lint-staged（pre-commit: lint + typecheck + 相关测试）           |
| 容器        | Docker + docker-compose（本地）                                          |
| API spec    | OpenAPI（由 zod-to-openapi 自动生成）                                    |

### 7.3 文档规则

**四类文档，各司其职：**

1. **`README.md` / `CONTRIBUTING.md`** — 入口，5 分钟跑通项目，长期维护
2. **`docs/architecture/`** — 长期架构（C4 图、模块职责），随大重构更新
3. **`docs/adr/NNNN-<topic>.md`** — 每个不可逆决策一份 ADR（Context / Decision / Consequences / Alternatives），追加不修改
4. **`docs/superpowers/specs/` + `plans/`** — brainstorming 与 writing-plans 输出，每个特性一份

**对外维护重点：**
- `docs/conventions/semantic-conventions.md` — 客户端开发者唯一要读的接入规范
- `docs/api/openapi.yaml` — 由代码自动生成，CI 校验同步

**变更日志：** `CHANGELOG.md` 由 `changesets` 生成；每个 PR 带 changeset 文件或显式标 `no-changeset`。

### 7.4 Git 工作流

- 主分支 `main`，所有改动经 PR 合入
- 分支前缀：`feat/` / `fix/` / `chore/` / `docs/` / `refactor/`
- 提交格式：Conventional Commits（`feat(server): ...`、`fix(web): ...`）
- PR 模板要求：
  - 关联的 spec / plan 路径
  - 变更摘要
  - 测试计划
  - 截图（如有 UI 变更）

### 7.5 CI（GitHub Actions）

- **on PR**：lint + typecheck + unit test + integration test (PG via service container) + web build
- **on push to main**：以上所有 + E2E + docker image build & push
- 用 Turborepo 远程缓存（GitHub Actions cache backend）
- 失败禁止合入

### 7.6 测试策略

- **单元测试**：StorageBackend impl、OTLP parser、auth、SSE 协议、各 Renderer
- **集成测试**：testcontainers 起真 PG，端到端 ingest → query
- **E2E**：Playwright，跑关键用户路径（注册 → 建项目 → 发 token → push trace → 看到 step）
- 不追求覆盖率数字；追求"核心路径不可静默回归"

### 7.7 本地开发

```bash
pnpm install
pnpm dev          # turbo 启动 server + web，热重载
pnpm db:up        # docker compose up postgres
pnpm db:migrate   # 应用 migrations
pnpm db:seed      # 灌入 demo data（含一个示例 trace）
pnpm test         # 跑所有单元测试
```

`pnpm db:seed` 提供"开箱即用"的演示数据，新人不必先去搞 OTel SDK 就能看到 UI。

---

## 8. 里程碑

> 仅描述逻辑增量与验收标准，不做时间估算。每个 M 完成验收后再推进下一个。

### M0 项目基础设施
- Monorepo 骨架（pnpm + Turbo）
- docker-compose: PG + server + web
- CI（lint / typecheck / test / build）
- README / CLAUDE.md / CONTRIBUTING.md
- 首批 ADR：
  - ADR-0001 "PG 而非 ClickHouse"
  - ADR-0002 "SSE 而非 WebSocket"
  - ADR-0003 "Kysely 而非 Prisma"
  - ADR-0004 "Fastify 而非 NestJS"
- **验收**：`pnpm dev` 起得来；CI 绿

### M1 最小闭环（ARGUS_MODE=local，单租户）
- OTLP HTTP 接收器（`/v1/traces`）
- `StorageBackend(PG)` 写入 spans / events
- REST 查询 API：会话列表 + 会话详情（仅返回原始 step JSON）
- Web：会话列表页 + 会话详情页（raw JSON 展示）
- seed 脚本：灌入示例会话
- `semantic-conventions.md` 首版
- **验收**：`curl` 发示例 OTLP payload，浏览器能看到这条会话

### M2 结构化回放体验
- 会话回放页布局：左侧虚拟列表 + 右侧详情
- Renderer 注册机制 + 4 个核心 renderer：
  `UserMessage` / `AssistantMessage` / `LlmCall` / `ToolCall`
- Tab 切换：Input / Output / Raw / Events
- `GenericJsonRenderer` 兜底
- **验收**：示例会话展示像样、能跳转任一步、信息组织清晰

### M3 实时直播
- `MessageBus(in-proc)` 抽象 + 写入后 publish
- SSE 端点：`/api/sessions/:id/stream`
- Web：`useSessionStream` hook（历史 + 增量自动接续）
- 背压策略 + 自动重连
- **验收**：运行中的会话能看到 step 一个个滚进来

### M4 多租户与公网注册
- User / Organization / Project / Service 模型
- 邮箱注册 + 登录（bcrypt + JWT cookie）
- 邮箱验证流程
- Ingest Token 管理界面
- PG row-level security 兜底
- 把 `ARGUS_MODE=local` 的硬编码绕过改成显式配置
- **验收**：两账户互不可见；新人能"注册 → 建项目 → 拿到 token → push trace → 看到 session"

### M5 gRPC ingest + DESIGN.md 应用
- OTLP gRPC 接收器（`:4317`）
- Unifi Console 风格 token 映射到 Tailwind theme
- UI 全面应用新风格
- **验收**：gRPC 与 HTTP 行为一致；视觉与 DESIGN.md 对齐

### M6 i18n
- i18next + react-i18next 接入
- `en`（默认）/ `zh-CN` / `ja`
- 语言切换器在用户菜单
- **验收**：三种语言切换正常，关键页面不漏翻

---

### MVP 之外（Future）
- ClickHouse 后端（千万级 span 时）
- 指标 / 日志接收
- 告警与趋势图
- SSO / OIDC
- 操作审计全链路
- Helm chart / K8s 部署文档
- 更多 step 渲染器（RAG 检索可视化等）
- 跨会话对比 / 业务分析仪表盘

---

## 9. 风险与开放问题

| 风险                                          | 缓解                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| OTel GenAI Semantic Conventions 仍在演进      | Argus 用 `argus.*` 扩展属性把不确定性隔离；标准稳定后再对齐    |
| PG JSONB 在大数据量下查询慢                   | 抽象 `StorageBackend`，扩展到 ClickHouse；短期靠分区 + 索引     |
| SSE 在企业代理穿透问题                        | 提供"轮询兜底"客户端模式                                        |
| 公网注册可能引来滥用                          | M4 加邮箱验证 + 简单 rate limit；架构上预留 captcha             |

**开放问题（待 M0 启动前再讨论）：**
- gRPC ingest 是否需要独立端口（4317 OTel 标准）vs 复用 HTTP 服务的进程
- 是否引入 Drizzle ORM 备选（目前定 Kysely）
- DESIGN.md 何时到位（影响 M5 调度）

---

## 10. 参考与链接

- OpenTelemetry GenAI Semantic Conventions: https://opentelemetry.io/docs/specs/semconv/gen-ai/
- OTLP 协议规范: https://github.com/open-telemetry/opentelemetry-proto
- Kysely: https://kysely.dev/
- Fastify v5: https://fastify.dev/
- TanStack Router: https://tanstack.com/router
- shadcn/ui: https://ui.shadcn.com/
