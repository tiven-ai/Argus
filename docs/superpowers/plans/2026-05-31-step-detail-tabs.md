# 步骤详情 Tab 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 session 步骤详情面板（`RoundDetail`）从竖排 5 段重组为 4 个 Tab（请求信息 / 执行过程 / 结果信息 / Raw），其中「执行过程」按「程序内部逻辑 / 调用外部资源（知识库·记忆·数据库·HTTP·其他）」两级分组。

**Architecture:** 纯前端改动。新增一个纯函数 `classifyExecutions` 负责分组逻辑（带单测）；`computeRounds` 小幅扩展以纳入 `external_resource` 执行 span；`RoundDetail` 改用已存在的 shadcn `Tabs` 组件组合现有 section；`ToolExecutionsSection` 的渲染逻辑迁入新的 `ExecutionSection`（按分组渲染）。i18n 三语补 key。

**Tech Stack:** React 19 + TypeScript（strict）+ Tailwind v4 + shadcn `@/components/ui/tabs`（已封装 `@radix-ui/react-tabs`）+ react-i18next + Vitest。

**Spec:** `docs/superpowers/specs/2026-05-31-step-detail-tabs-design.md`

**测试命令约定（全程使用）：**

- 跑单个测试文件：`pnpm --filter @argus/web exec vitest run <相对 apps/web 的路径>`
- 跑全部 web 测试：`pnpm --filter @argus/web test`
- 构建（含 tsc）：`pnpm --filter @argus/web build`
- Lint：`pnpm --filter @argus/web lint`

> 注：所有 `git add` 路径相对仓库根 `/Users/fooevr/Code/argus`。提交信息遵循 conventional commits + commitlint（subject 用小写、句首非大写）。

---

## File Structure

| 文件                                                                             | 角色                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/features/session-replay/lib/classify-execution.ts`                 | **新增**。纯函数 `classifyExecutions(steps)` + 类型 `ExecutionCategory` / `ExecutionGroup`。承载全部分组逻辑。 |
| `apps/web/src/features/session-replay/lib/classify-execution.test.ts`            | **新增**。`classifyExecutions` 单测。                                                                          |
| `apps/web/src/features/session-replay/lib/compute-rounds.ts`                     | **修改**。`toolExecutions` 过滤纳入 `kind === 'external_resource'`。                                           |
| `apps/web/src/features/session-replay/lib/compute-rounds.test.ts`                | **修改**。加一条 `external_resource` 纳入用例。                                                                |
| `apps/web/src/features/session-replay/detail/sections/ExecutionSection.tsx`      | **新增**。按 `classifyExecutions` 分组渲染执行卡片。                                                           |
| `apps/web/src/features/session-replay/detail/sections/ToolExecutionsSection.tsx` | **删除**。逻辑迁入 `ExecutionSection`。                                                                        |
| `apps/web/src/features/session-replay/detail/RoundDetail.tsx`                    | **重写**。`RoundHeader` + 4 个 Tab。                                                                           |
| `apps/web/src/i18n/locales/en.json`                                              | **修改**。新增 `round.tabs.*`、`round.execution.*`。                                                           |
| `apps/web/src/i18n/locales/zh-CN.json`                                           | **修改**。同上（全角标点）。                                                                                   |
| `apps/web/src/i18n/locales/ja.json`                                              | **修改**。同上。                                                                                               |

不动：`ContextSection`、`TriggerSection`、`LlmResponseSection`、`RawSection`、`tool-displays.tsx`、`RoundHeader.tsx`、`index.tsx`。

任务顺序：先纯函数（Task 1）→ 数据扩展（Task 2）→ i18n（Task 3）→ ExecutionSection（Task 4）→ RoundDetail 重写 + 删除旧文件（Task 5）→ 全量验证（Task 6）。

---

## Task 1: `classifyExecutions` 纯函数 + 单测

把「执行过程」的两级分组逻辑实现为不依赖 React 的纯函数，方便测试。

**Files:**

- Create: `apps/web/src/features/session-replay/lib/classify-execution.ts`
- Test: `apps/web/src/features/session-replay/lib/classify-execution.test.ts`

- [ ] **Step 1: 写失败测试**

Create `apps/web/src/features/session-replay/lib/classify-execution.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Step } from '@argus/shared-types'
import { classifyExecutions } from './classify-execution'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    spanId: 'a'.repeat(16),
    parentSpanId: null,
    name: overrides.name ?? 'test',
    kind: overrides.kind ?? 'tool_call',
    componentType: null,
    componentName: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    attributes: {},
    statusCode: 'OK',
    statusMessage: null,
    events: [],
    ...overrides,
  }
}

describe('classifyExecutions', () => {
  it('returns [] for empty input', () => {
    expect(classifyExecutions([])).toEqual([])
  })

  it('classifies custom_tool / skill / middleware / unknown / missing as internal', () => {
    const steps = [
      makeStep({ id: 'a', componentType: 'custom_tool' }),
      makeStep({ id: 'b', componentType: 'skill' }),
      makeStep({ id: 'c', componentType: 'middleware' }),
      makeStep({ id: 'd', componentType: 'something_else' }),
      makeStep({ id: 'e', componentType: null }),
    ]
    const groups = classifyExecutions(steps)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.category).toBe('internal')
    expect(groups[0]?.steps.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('classifies external_resource / mcp as external and sub-categorizes by name', () => {
    const steps = [
      makeStep({ id: 'kb', componentType: 'external_resource', componentName: 'knowledge_search' }),
      makeStep({ id: 'mem', componentType: 'external_resource', componentName: 'memory_recall' }),
      makeStep({ id: 'db', componentType: 'mcp', componentName: 'run_sql_query' }),
      makeStep({ id: 'http', componentType: 'external_resource', componentName: 'http_fetch' }),
      makeStep({ id: 'misc', componentType: 'external_resource', componentName: 'do_thing' }),
    ]
    const groups = classifyExecutions(steps)
    const byCat = Object.fromEntries(groups.map((g) => [g.category, g.steps.map((s) => s.id)]))
    expect(byCat).toEqual({
      knowledge: ['kb'],
      memory: ['mem'],
      database: ['db'],
      http: ['http'],
      other: ['misc'],
    })
  })

  it('falls back to step.name when componentName is null', () => {
    const steps = [
      makeStep({
        id: 'x',
        componentType: 'external_resource',
        componentName: null,
        name: 'vector_lookup',
      }),
    ]
    const groups = classifyExecutions(steps)
    expect(groups[0]?.category).toBe('knowledge')
  })

  it('orders groups: internal first, then knowledge→memory→database→http→other', () => {
    const steps = [
      makeStep({ id: 'http', componentType: 'external_resource', componentName: 'api_call' }),
      makeStep({ id: 'misc', componentType: 'external_resource', componentName: 'do_thing' }),
      makeStep({ id: 'kb', componentType: 'external_resource', componentName: 'rag_search' }),
      makeStep({ id: 'int', componentType: 'custom_tool', componentName: 'get_weather' }),
      makeStep({ id: 'db', componentType: 'external_resource', componentName: 'postgres_select' }),
      makeStep({ id: 'mem', componentType: 'external_resource', componentName: 'recall_fact' }),
    ]
    const groups = classifyExecutions(steps)
    expect(groups.map((g) => g.category)).toEqual([
      'internal',
      'knowledge',
      'memory',
      'database',
      'http',
      'other',
    ])
  })

  it('omits empty groups', () => {
    const steps = [makeStep({ id: 'int', componentType: 'custom_tool' })]
    const groups = classifyExecutions(steps)
    expect(groups.map((g) => g.category)).toEqual(['internal'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @argus/web exec vitest run src/features/session-replay/lib/classify-execution.test.ts`
Expected: FAIL —「Failed to resolve import './classify-execution'」或 `classifyExecutions is not a function`。

- [ ] **Step 3: 写实现**

Create `apps/web/src/features/session-replay/lib/classify-execution.ts`:

```ts
import type { Step } from '@argus/shared-types'

export type ExecutionCategory = 'internal' | 'knowledge' | 'memory' | 'database' | 'http' | 'other'

export interface ExecutionGroup {
  category: ExecutionCategory
  steps: Step[]
}

// 第一级：靠 component.type 区分"调用外部资源" vs "程序内部逻辑"。
const EXTERNAL_TYPES = new Set(['external_resource', 'mcp'])

// 第二级（仅外部资源）：靠名称子串启发式归类。顺序匹配，命中即止。
const EXTERNAL_KEYWORDS: Array<[Exclude<ExecutionCategory, 'internal' | 'other'>, string[]]> = [
  ['knowledge', ['knowledge', 'kb', 'retriev', 'vector', 'embed', 'rag', 'search']],
  ['memory', ['memory', 'recall', 'mem0']],
  ['database', ['db', 'sql', 'database', 'query', 'postgres', 'mysql', 'mongo', 'redis']],
  ['http', ['http', 'api', 'fetch', 'request', 'url', 'rest', 'webhook']],
]

// 渲染顺序：internal 在前，外部资源类目按固定顺序，other 兜底最后。
const ORDER: ExecutionCategory[] = ['internal', 'knowledge', 'memory', 'database', 'http', 'other']

function categoryFor(step: Step): ExecutionCategory {
  if (!EXTERNAL_TYPES.has(step.componentType ?? '')) return 'internal'
  const label = (step.componentName ?? step.name).toLowerCase()
  for (const [category, keywords] of EXTERNAL_KEYWORDS) {
    if (keywords.some((kw) => label.includes(kw))) return category
  }
  return 'other'
}

export function classifyExecutions(steps: Step[]): ExecutionGroup[] {
  const buckets = new Map<ExecutionCategory, Step[]>()
  for (const step of steps) {
    const category = categoryFor(step)
    const bucket = buckets.get(category)
    if (bucket) bucket.push(step)
    else buckets.set(category, [step])
  }
  return ORDER.filter((c) => buckets.has(c)).map((category) => ({
    category,
    steps: buckets.get(category)!,
  }))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @argus/web exec vitest run src/features/session-replay/lib/classify-execution.test.ts`
Expected: PASS（6 个测试全绿）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/session-replay/lib/classify-execution.ts apps/web/src/features/session-replay/lib/classify-execution.test.ts
git commit -m "feat(web): classifyExecutions helper for execution grouping"
```

---

## Task 2: `computeRounds` 纳入 `external_resource`

让「执行过程」能收集 `tool_call` 以外的外部资源执行 span。

**Files:**

- Modify: `apps/web/src/features/session-replay/lib/compute-rounds.ts`
- Test: `apps/web/src/features/session-replay/lib/compute-rounds.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/web/src/features/session-replay/lib/compute-rounds.test.ts` 的 `describe('computeRounds', ...)` 块内、最后一个 `it(...)` 之后、`})` 之前，新增：

```ts
it('includes external_resource steps in toolExecutions', () => {
  const steps = [
    makeStep({
      id: 'l1',
      kind: 'llm_call',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:01Z',
    }),
    makeStep({
      id: 'ext',
      kind: 'external_resource',
      startedAt: '2026-01-01T00:00:02Z',
      endedAt: '2026-01-01T00:00:03Z',
    }),
    makeStep({
      id: 't1',
      kind: 'tool_call',
      startedAt: '2026-01-01T00:00:03.5Z',
      endedAt: '2026-01-01T00:00:04Z',
    }),
  ]
  const rounds = computeRounds(steps)
  expect(rounds[0]?.toolExecutions.map((s) => s.id)).toEqual(['ext', 't1'])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @argus/web exec vitest run src/features/session-replay/lib/compute-rounds.test.ts`
Expected: FAIL — 新用例期望 `['ext', 't1']`，实际只得到 `['t1']`（`external_resource` 未被纳入）。

- [ ] **Step 3: 写实现**

在 `apps/web/src/features/session-replay/lib/compute-rounds.ts` 的 `toolExecutions` 过滤里，把对 `kind` 的判断从只认 `tool_call` 扩展为也认 `external_resource`。

把这一段：

```ts
const toolExecutions = sorted.filter(
  (s) =>
    s.kind === 'tool_call' &&
    s.startedAt >= llm.endedAt &&
    s.startedAt < nextStart &&
    !llmIndices.has(s.id),
)
```

改为：

```ts
const toolExecutions = sorted.filter(
  (s) =>
    (s.kind === 'tool_call' || s.kind === 'external_resource') &&
    s.startedAt >= llm.endedAt &&
    s.startedAt < nextStart &&
    !llmIndices.has(s.id),
)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @argus/web exec vitest run src/features/session-replay/lib/compute-rounds.test.ts`
Expected: PASS（原有用例 + 新用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/session-replay/lib/compute-rounds.ts apps/web/src/features/session-replay/lib/compute-rounds.test.ts
git commit -m "feat(web): include external_resource spans in round executions"
```

---

## Task 3: i18n 三语补 key

新增 `round.tabs.*`（4 个 Tab 标签）与 `round.execution.*`（分组标签）。复用现有 `round.sections.*` 作为 Tab 内部小标题。

**Files:**

- Modify: `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/i18n/locales/zh-CN.json`
- Modify: `apps/web/src/i18n/locales/ja.json`

- [ ] **Step 1: 改 en.json**

在 `apps/web/src/i18n/locales/en.json` 中，定位 `"round"` 对象内的 `"sections"` 块（`"sections": { ... }`）。在 `"sections"` 块的结束 `},` 之后、`"context"` 块之前，插入：

```json
    "tabs": {
      "request": "Request",
      "execution": "Execution",
      "result": "Result",
      "raw": "Raw"
    },
    "execution": {
      "internal": "Internal logic",
      "knowledge": "Knowledge base",
      "memory": "Memory",
      "database": "Database",
      "http": "HTTP",
      "other": "Other resources"
    },
```

- [ ] **Step 2: 改 zh-CN.json**

在 `apps/web/src/i18n/locales/zh-CN.json` 中，同样定位 `"round"` 内 `"sections"` 块结束 `},` 之后、`"context"` 之前，插入（全角标点）：

```json
    "tabs": {
      "request": "请求信息",
      "execution": "执行过程",
      "result": "结果信息",
      "raw": "Raw"
    },
    "execution": {
      "internal": "程序内部逻辑",
      "knowledge": "知识库",
      "memory": "记忆",
      "database": "数据库",
      "http": "HTTP",
      "other": "其他外部资源"
    },
```

- [ ] **Step 3: 改 ja.json**

在 `apps/web/src/i18n/locales/ja.json` 中，同样定位 `"round"` 内 `"sections"` 块结束 `},` 之后、`"context"` 之前，插入：

```json
    "tabs": {
      "request": "リクエスト",
      "execution": "実行",
      "result": "結果",
      "raw": "Raw"
    },
    "execution": {
      "internal": "内部ロジック",
      "knowledge": "ナレッジベース",
      "memory": "メモリ",
      "database": "データベース",
      "http": "HTTP",
      "other": "その他のリソース"
    },
```

- [ ] **Step 4: 校验三份 JSON 合法**

Run:

```bash
node -e "for (const f of ['en','zh-CN','ja']) { JSON.parse(require('fs').readFileSync('apps/web/src/i18n/locales/'+f+'.json','utf8')); console.log(f, 'OK') }"
```

Expected: 三行 `en OK` / `zh-CN OK` / `ja OK`，无解析错误。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/zh-CN.json apps/web/src/i18n/locales/ja.json
git commit -m "feat(web): i18n keys for round detail tabs and execution groups"
```

---

## Task 4: `ExecutionSection` 组件（替代 ToolExecutionsSection）

按 `classifyExecutions` 分组渲染执行卡片。卡片渲染逻辑沿用原 `ToolExecutionsSection`（图标 + 名称 + Input + Output），外层加分组小标题。

**Files:**

- Create: `apps/web/src/features/session-replay/detail/sections/ExecutionSection.tsx`

> 本任务只新增 `ExecutionSection`；旧的 `ToolExecutionsSection.tsx` 在 Task 5 切换 `RoundDetail` 引用后删除，避免本步出现 unused 文件导致中间态报错。

- [ ] **Step 1: 写组件**

Create `apps/web/src/features/session-replay/detail/sections/ExecutionSection.tsx`:

```tsx
import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Step } from '@argus/shared-types'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'
import { classifyExecutions, type ExecutionCategory } from '../../lib/classify-execution'

interface Props {
  round: Round
}

function ExecutionCard({ step }: { step: Step }) {
  const { t } = useTranslation()
  const input = findEvent(step, 'argus.input')?.attributes ?? {}
  const output = findEvent(step, 'argus.output')?.attributes
  const name = step.componentName ?? step.name
  return (
    <li className="border border-hairline rounded p-2 space-y-2">
      <div className="flex items-center gap-2 u-body">
        <Wrench className="h-4 w-4 text-text-3" strokeWidth={1.75} />
        <span className="font-mono text-text-1">{name}</span>
      </div>
      <div>
        <p className="u-caption text-text-3 mb-1">{t('round.toolExecution.input')}</p>
        <pre className="u-caption bg-tile border border-hairline p-2 rounded overflow-auto text-text-2">
          {JSON.stringify(input, null, 2)}
        </pre>
      </div>
      <div>
        <p className="u-caption text-text-3 mb-1">{t('round.toolExecution.output')}</p>
        {output ? (
          <pre className="u-caption bg-tint-success p-2 rounded overflow-auto text-text-1">
            {JSON.stringify(output, null, 2)}
          </pre>
        ) : (
          <p className="u-caption text-text-4">{t('round.toolExecution.noOutput')}</p>
        )}
      </div>
    </li>
  )
}

export function ExecutionSection({ round }: Props) {
  const { t } = useTranslation()
  const groups = classifyExecutions(round.toolExecutions)

  if (groups.length === 0) {
    return <p className="u-body text-text-3">{t('round.toolExecution.empty')}</p>
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.category}>
          <h4 className="u-caption text-text-3 mb-2">
            {t(
              `round.execution.${group.category}` satisfies `round.execution.${ExecutionCategory}`,
            )}
          </h4>
          <ul className="space-y-4">
            {group.steps.map((step) => (
              <ExecutionCard key={step.id} step={step} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: typecheck 确认无类型错误**

Run: `pnpm --filter @argus/web exec tsc --noEmit`
Expected: 无错误退出（exit 0）。若报 `round.execution.${...}` 模板字面量相关错误，把那行简化为 `{t('round.execution.' + group.category)}`（去掉 `satisfies` 断言）后重跑。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/features/session-replay/detail/sections/ExecutionSection.tsx
git commit -m "feat(web): ExecutionSection renders executions grouped by category"
```

---

## Task 5: 重写 `RoundDetail` 为 Tab 布局 + 删除旧 section

把 `RoundHeader` 留在顶部，下方放 4 个 Tab：请求信息（Trigger + Context）/ 执行过程（ExecutionSection）/ 结果信息（LlmResponse）/ Raw。删除不再被引用的 `ToolExecutionsSection.tsx`。

**Files:**

- Modify (重写): `apps/web/src/features/session-replay/detail/RoundDetail.tsx`
- Delete: `apps/web/src/features/session-replay/detail/sections/ToolExecutionsSection.tsx`

- [ ] **Step 1: 重写 RoundDetail.tsx**

把 `apps/web/src/features/session-replay/detail/RoundDetail.tsx` **整个文件**替换为：

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Round } from '../types/round'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RoundHeader } from './RoundHeader'
import { ContextSection } from './sections/ContextSection'
import { TriggerSection } from './sections/TriggerSection'
import { LlmResponseSection } from './sections/LlmResponseSection'
import { ExecutionSection } from './sections/ExecutionSection'
import { RawSection } from './sections/RawSection'

interface Props {
  round: Round
  index: number
  total: number
}

function SectionHeading({ title }: { title: string }) {
  return <h4 className="u-h-md text-text-1 mb-2">{title}</h4>
}

export function RoundDetail({ round, index, total }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('request')

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <RoundHeader round={round} index={index} total={total} />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="request">{t('round.tabs.request')}</TabsTrigger>
          <TabsTrigger value="execution">{t('round.tabs.execution')}</TabsTrigger>
          <TabsTrigger value="result">{t('round.tabs.result')}</TabsTrigger>
          <TabsTrigger value="raw">{t('round.tabs.raw')}</TabsTrigger>
        </TabsList>

        <TabsContent value="request" className="space-y-5">
          <section>
            <SectionHeading title={t('round.sections.trigger')} />
            <TriggerSection round={round} />
          </section>
          <section>
            <SectionHeading title={t('round.sections.context')} />
            <ContextSection round={round} />
          </section>
        </TabsContent>

        <TabsContent value="execution">
          <ExecutionSection round={round} />
        </TabsContent>

        <TabsContent value="result">
          <LlmResponseSection round={round} />
        </TabsContent>

        <TabsContent value="raw">
          <RawSection round={round} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 2: 删除旧 section 文件**

Run: `git rm apps/web/src/features/session-replay/detail/sections/ToolExecutionsSection.tsx`
Expected: `rm 'apps/web/...ToolExecutionsSection.tsx'`，文件被删除并 staged。

- [ ] **Step 3: 确认无残留引用**

Run: `grep -rn "ToolExecutionsSection" apps/web/src`
Expected: 无输出（无任何残留 import/引用）。若有输出，去对应文件清掉该引用。

- [ ] **Step 4: typecheck + lint**

Run:

```bash
pnpm --filter @argus/web exec tsc --noEmit && pnpm --filter @argus/web lint
```

Expected: 两者均 exit 0、无错误/新告警。（`ChevronDown` / `ChevronRight` / `Collapsible` 等旧 import 已随整文件替换移除，不应再有 unused 告警。）

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/features/session-replay/detail/RoundDetail.tsx
git commit -m "feat(web): tabbed round detail (request / execution / result / raw)"
```

---

## Task 6: 全量验证

确保整个 web 包测试、构建、lint 全绿，并人工核对页面。

**Files:** 无（仅运行命令 + 浏览器核对）。

- [ ] **Step 1: 跑全部 web 单测**

Run: `pnpm --filter @argus/web test`
Expected: 所有测试 PASS（含 `classify-execution.test.ts`、`compute-rounds.test.ts`、`step-helpers.test.ts`）。

- [ ] **Step 2: 构建**

Run: `pnpm --filter @argus/web build`
Expected: `tsc -b` 与 `vite build` 均成功，无类型错误。

- [ ] **Step 3: Lint**

Run: `pnpm --filter @argus/web lint`
Expected: exit 0，无新增告警。

- [ ] **Step 4: 浏览器人工核对（preview 工具）**

启动 dev server（preview_start），打开一个有工具调用的 session（seed 数据里的 `weather-bot` / `code-review-bot` / `support-bot` 任一），核对：

1. 详情顶部为 `RoundHeader`，其下是 4 个 Tab：请求信息 / 执行过程 / 结果信息 / Raw。
2. 请求信息 Tab 同时显示「触发源」与「上下文」两个小节。
3. 执行过程 Tab 显示分组小标题「程序内部逻辑」，下面是工具调用卡片（seed 全是 `custom_tool`，应只见此一组）。
4. 结果信息 Tab 显示 LLM 文本 / 工具调用 / stop 原因。
5. Raw Tab 显示整轮 JSON。
6. 点左侧切换到另一轮，**当前 Tab 保持不变**（如停在「执行过程」则切轮后仍在「执行过程」）。
7. 切换语言（顶栏）确认三语 Tab 标签与分组标签都正确显示，无原始 key 字符串（如未翻译会显示 `round.tabs.request`）。

截图留证（preview_screenshot），确认无 console 报错（preview_console_logs）。

- [ ] **Step 5: 终验提交（如有 lint/format 自动改动）**

若上述步骤产生了 lint-staged 的格式化改动，确认已提交；否则本任务无新提交。最终：

```bash
git status
git log --oneline -6
```

Expected: working tree clean（除既有的未跟踪文件如 `.idea/`、`seed-tmp.ts`、`apps/web/.tanstack/`），最近 5 次提交对应 Task 1–5。

---

## Self-Review

**Spec 覆盖核对：**

- Tab 结构（4 个 Tab、Header 共享、恒定显示、默认 request、切轮保持）→ Task 5 ✓
- 执行过程两级分组（一级 component.type，二级名称启发式，顺序固定，空组省略）→ Task 1（逻辑）+ Task 4（渲染）✓
- 数据层扩展（纳入 external_resource）→ Task 2 ✓
- i18n 三语（round.tabs._ / round.execution._，复用 sections.\*，全角标点）→ Task 3 ✓
- 组件改动清单（新增 ExecutionSection、删除 ToolExecutionsSection、不动其余）→ Task 4 + Task 5 ✓
- 测试（classify-execution 单测各场景、compute-rounds 加 external_resource 用例）→ Task 1 + Task 2 ✓
- 验收标准 1–6 → Task 6 逐条核对 ✓

**占位符扫描：** 无 TBD/TODO；每个改代码的步骤都给了完整代码或精确的字符串替换。✓

**类型一致性：** `classifyExecutions` / `ExecutionGroup` / `ExecutionCategory`（`'internal' | 'knowledge' | 'memory' | 'database' | 'http' | 'other'`）在 Task 1 定义，Task 4 按同名同形使用；i18n key `round.execution.<category>` 与类型枚举值一一对应（Task 3 的 key 名 = Task 1 的 category 字面量）。✓

```

```
