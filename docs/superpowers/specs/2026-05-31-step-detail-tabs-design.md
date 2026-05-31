# 步骤详情 Tab 化设计（请求信息 / 执行过程 / 结果信息 / Raw）

> 日期：2026-05-31
> 状态：已批准方案，待写实现计划
> 范围：仅前端 `apps/web`，session-replay 右侧详情面板

## 背景与目标

当前 session 步骤详情（`RoundDetail.tsx`）把一轮（Round）的信息竖排成 5 个 section：
Context（折叠）、Trigger、LLM Response、Tool execution、Raw（折叠）。信息密度高、需要上下滚动。

目标：按「请求 → 执行 → 结果」三段语义把详情重组为 Tab，让用户能聚焦某一段，并能在切换轮次时保持当前 Tab 以便横向对比。「执行过程」进一步按调用性质两级分组，区分**程序内部逻辑**与**调用外部资源**（知识库 / 记忆 / 数据库 / HTTP）。

## 数据现状（重要前提）

- 数据模型 `Step`（`packages/shared-types`）有 `kind`、`componentType`、`componentName`，以及 `argus.input` / `argus.output` / `argus.error` 三个 span event。没有专门的"模块类型"字段。
- 语义约定（`docs/conventions/semantic-conventions.md`）里 `argus.component.type` 合法取值为：`llm`、`skill`、`mcp`、`middleware`、`custom_tool`、`external_resource`。
- **现实**：示例 trace（`scripts/example-trace.json`）与 seed（`apps/server/seed-tmp.ts`、`apps/server/src/cli/seed.ts`）里，所有工具调用的 `componentType` 都是 `custom_tool`，LLM 是 `llm`。当前数据中**没有** `external_resource` / `mcp` / `skill` / `middleware`。

结论：「执行过程」按 `component.type` 做一级分组在数据可用时可靠；但在现有数据下，几乎所有调用会落进「程序内部逻辑」分组。外部资源的细分（知识库/记忆/数据库/HTTP）依赖上游 instrumentation 实际写入 `component.type`，在此之前只能靠名称启发式猜测。本设计接受这个现实——UI 会随数据变好而自然变好，不为不存在的数据造假。

## Tab 结构

`RoundHeader`（轮次标题 / 状态 / 耗时 / token / 工具数）保持在 Tab 条**上方**，四个 Tab 共享。Tab 条下方是当前 Tab 的内容。

| Tab       | 中文标签 | 内容                                                                               | 复用                                |
| --------- | -------- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| request   | 请求信息 | 触发来源（用户消息 / 上一轮工具结果）+ 上下文（system prompt、可用工具、历史消息） | `TriggerSection` + `ContextSection` |
| execution | 执行过程 | 本轮 LLM 之后真正执行的调用，按两级分组                                            | 重构自 `ToolExecutionsSection`      |
| result    | 结果信息 | LLM 输出：文本、决定调用的 tool calls、stop_reason                                 | `LlmResponseSection`                |
| raw       | Raw      | 整轮对象 JSON dump（开发者逃生舱）                                                 | `RawSection`                        |

- 四个 Tab **恒定显示**，不因内容为空而隐藏；空内容由各 section 内已有的空状态文案承担（如 `round.context.empty`、`round.toolExecution.empty`、`round.llmResponse.empty`）。
- Tab 默认选中「请求信息」。
- Tab 状态用 `RoundDetail` 内部 `useState`。因为切换轮次时 `RoundDetail` 不会 remount（同一组件实例、仅 `round` prop 变化），当前 Tab 天然保留，支持跨轮次盯同一 Tab 对比。

## 「执行过程」两级分组

新增纯函数模块 `apps/web/src/features/session-replay/lib/classify-execution.ts`，输入 `Step[]`（即 `round.toolExecutions`），输出有序的分组结构供组件渲染。

### 一级：调用性质（靠 `component.type`，可靠）

| component.type                                  | 一级分组                 |
| ----------------------------------------------- | ------------------------ |
| `external_resource`、`mcp`                      | 调用外部资源（external） |
| `skill`、`middleware`、`custom_tool`、其它/缺失 | 程序内部逻辑（internal） |

渲染顺序固定：先「程序内部逻辑」，后「调用外部资源」。

### 二级：外部资源类目（仅在 external 下，靠名称启发式，会猜、可调）

对 external 组内每个 step，按 `componentName ?? name` 小写后匹配关键字归类（顺序匹配，命中即止）：

| 类目                | 关键字（子串匹配，小写）                                                |
| ------------------- | ----------------------------------------------------------------------- |
| knowledge（知识库） | `knowledge`、`kb`、`retriev`、`vector`、`embed`、`rag`、`search`        |
| memory（记忆）      | `memory`、`recall`、`mem0`                                              |
| database（数据库）  | `db`、`sql`、`database`、`query`、`postgres`、`mysql`、`mongo`、`redis` |
| http（HTTP）        | `http`、`api`、`fetch`、`request`、`url`、`rest`、`webhook`             |
| other（其他）       | 兜底，未命中以上任何类目                                                |

二级类目渲染顺序固定：knowledge → memory → database → http → other。

### 输出结构（建议）

```ts
export type ExecutionCategory = 'internal' | 'knowledge' | 'memory' | 'database' | 'http' | 'other'

export interface ExecutionGroup {
  category: ExecutionCategory
  steps: Step[]
}

// 返回非空分组，按固定顺序：internal 在前，外部资源类目按 knowledge→memory→database→http→other
export function classifyExecutions(steps: Step[]): ExecutionGroup[]
```

组件 `ExecutionSection`（取代 `ToolExecutionsSection`）：

- 调 `classifyExecutions(round.toolExecutions)`。
- 每个非空分组渲染一个带标签（+ 图标）的小标题 + 一组执行卡片。
- 执行卡片复用现有「图标 + 名称（mono）+ Input(JSON) + Output(JSON / noOutput)」样式。
- `round.toolExecutions` 为空时显示 `round.toolExecution.empty`。
- 只有一个分组时也照常显示该分组标题（保持结构一致、自解释）。

## 数据层小扩展

`computeRounds`（`lib/compute-rounds.ts`）当前只把 `kind === 'tool_call'` 收进 `toolExecutions`。为让「执行过程」能纳入"调用外部资源"，扩展过滤条件为同时纳入 `kind === 'external_resource'`：

```ts
s.kind === 'tool_call' || s.kind === 'external_resource'
```

其余窗口逻辑（在本轮 LLM 结束之后、下一轮 LLM 开始之前、且不是 LLM call）不变。

字段名 `round.toolExecutions` **保留不改**（tool_call 仍是主体，改名会牵动 6 处且无功能收益），语义略微变宽为"本轮执行的调用"。

## i18n

三份 locale（`en.json` / `zh-CN.json` / `ja.json`）都新增：

```jsonc
"round": {
  "tabs": {
    "request": "请求信息",      // Request / リクエスト
    "execution": "执行过程",    // Execution / 実行
    "result": "结果信息",       // Result / 結果
    "raw": "Raw"               // Raw / Raw
  },
  "execution": {
    "internal": "程序内部逻辑",      // Internal logic / 内部ロジック
    "knowledge": "知识库",          // Knowledge base / ナレッジベース
    "memory": "记忆",               // Memory / メモリ
    "database": "数据库",           // Database / データベース
    "http": "HTTP",                // HTTP / HTTP
    "other": "其他外部资源"          // Other resources / その他のリソース
  }
}
```

复用现有的 `round.sections.*`（context / trigger / llmResponse / toolExecution）作为 Tab **内部**的小标题；`round.context.*`、`round.llmResponse.*`、`round.toolExecution.*`、`tool.*` 全部保持不变。
中文使用全角标点。

## 组件改动清单

| 文件                                        | 改动                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `detail/RoundDetail.tsx`                    | 重写为 `RoundHeader` + `Tabs/TabsList/TabsTrigger/TabsContent`（4 个 Tab）。请求 Tab 内组合 `TriggerSection` + `ContextSection`；执行 Tab 用新 `ExecutionSection`；结果 Tab 用 `LlmResponseSection`；Raw Tab 用 `RawSection`。 |
| `detail/sections/ExecutionSection.tsx`      | 新增。替代 `ToolExecutionsSection`，按 `classifyExecutions` 分组渲染。卡片渲染逻辑沿用原 `ToolExecutionsSection`（图标/名称/Input/Output）。                                                                                   |
| `detail/sections/ToolExecutionsSection.tsx` | 删除（其渲染逻辑迁入 `ExecutionSection`）。                                                                                                                                                                                    |
| `lib/classify-execution.ts`                 | 新增纯函数 + 类型。                                                                                                                                                                                                            |
| `lib/compute-rounds.ts`                     | 扩展过滤纳入 `external_resource`。                                                                                                                                                                                             |
| `i18n/locales/{en,zh-CN,ja}.json`           | 新增 `round.tabs.*`、`round.execution.*`。                                                                                                                                                                                     |

`@/components/ui/tabs`（已存在，封装 `@radix-ui/react-tabs`）直接复用，无需新依赖。其余 section 文件（`ContextSection`、`TriggerSection`、`LlmResponseSection`、`RawSection`、`tool-displays.tsx`）不动。`RoundHeader` 不动。

## 测试

- `lib/classify-execution.test.ts`（新增）：
  - `external_resource` / `mcp` → internal 之外的 external 一级归类。
  - `skill` / `middleware` / `custom_tool` / 未知 / 缺失 → internal。
  - external 下的二级名称启发式：每个类目至少一个命中样例 + 一个兜底 other 样例。
  - 分组顺序：internal 在前，external 类目按固定顺序。
  - 空输入 → `[]`。
- `lib/compute-rounds.test.ts`（修改）：加一条用例断言 `kind === 'external_resource'` 的 span 也进入 `toolExecutions`。
- 组件层：沿用本仓现状，不强制快照测试；展示逻辑已抽进纯函数覆盖。

## 验收标准

1. 详情面板顶部为共享的 `RoundHeader`，其下为 4 个 Tab：请求信息 / 执行过程 / 结果信息 / Raw。
2. 请求信息 Tab 同时显示触发来源与上下文；结果信息 Tab 显示 LLM 文本 + tool calls + stop_reason；Raw Tab 显示整轮 JSON。
3. 执行过程 Tab 按「程序内部逻辑 / 调用外部资源（含二级类目）」分组；现有 seed 数据下全部归入「程序内部逻辑」且能正常显示。
4. 切换左侧轮次时保持当前选中的 Tab。
5. `pnpm --filter @argus/web test`（含新增/修改的单测）与 `pnpm --filter @argus/web build` 通过；`pnpm --filter @argus/web lint` 无新增告警。
6. 三语 i18n key 齐全，无缺失 key 告警。

## 非目标 / 后续

- 不改后端、shared-types、数据库、instrumentation。
- 不为缺失的 `component.type` 在前端伪造分类之外的数据。
- 真正可靠的「知识库 / 记忆 / 数据库 / HTTP」区分需上游 trace 写入 `argus.component.type`（及可能的更细约定），属后续工作，必要时走 ADR。
