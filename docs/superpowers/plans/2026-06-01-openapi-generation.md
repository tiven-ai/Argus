# OpenAPI 生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从已有的 Zod schema 生成一份覆盖公开 API（ingest + 只读会话 + healthz）的 OpenAPI 3 spec，提交 `docs/api/openapi.yaml`，并用 CI"重新生成 + git diff"守住不漂移。

**Architecture:** 用 `@asteasolutions/zod-to-openapi` 的 registry 注册 4 个端点（复用 shared-types 已有响应 schema + ingest 的 OTLP body schema），一个纯函数 `buildOpenApiDocument()` 产出 OpenAPI 文档对象；一个 CLI 把它序列化为 YAML 写入 `docs/api/openapi.yaml`。生成与运行时 `safeParse` 校验解耦。

**Tech Stack:** TypeScript + Zod 3.25（已在用）+ `@asteasolutions/zod-to-openapi@^7.3.4`（**必须 v7——v8 要求 Zod 4，对本仓库 Zod 3 schema 会崩**，已实测）+ `yaml`（序列化，需新增）+ Vitest + tsx + GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-06-01-openapi-generation-design.md`

**经实测确认的关键事实（写计划时已验证）：**

- `zod-to-openapi` 必须用 **v7**（`^7.3.4`，peer dep `zod ^3.20.2`）。v8 针对 Zod 4，对本仓库 Zod 3 schema 抛 `Cannot read properties of undefined (reading 'parent')`。
- server 与 shared-types 解析到**同一个** zod 实例（`zod@3.25.76` 去重），所以 `extendZodWithOpenApi(z)` 作用于 server 的 `z` 也会让 shared-types 的 schema 可用——无需改 shared-types。
- 端到端生成已跑通：4 个 path 全在、OTLP requestBody 捕获、path param 提取正常、合法 `openapi: 3.0.3`。schema 默认**内联**（不 `$ref`），合法且更简单。
- 仓库**没有** yaml 序列化库，需新增 `yaml`。

**命令约定：**

- 生成：`pnpm --filter @argus/server gen:openapi`
- 单测：`pnpm --filter @argus/server exec vitest run test/openapi/registry.test.ts`（globalSetup 会起 Postgres testcontainer，需 Docker；本测试不用 DB 但仍在套件内）
- 提交遵循 commitlint（subject 小写）。预提交钩子格式化 `*.{json,md,yml,yaml,css}`——`.ts` 不在 glob。不要 `--no-verify`。

---

## File Structure

| 文件                                        | 角色                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/server/package.json`                  | 加 `@asteasolutions/zod-to-openapi@^7.3.4` + `yaml` 依赖；加 `gen:openapi` 脚本。 |
| `apps/server/src/openapi/registry.ts`       | 注册 4 个端点 + 导出纯函数 `buildOpenApiDocument()`。                             |
| `apps/server/src/cli/gen-openapi.ts`        | 调 `buildOpenApiDocument()` → YAML → 写 `docs/api/openapi.yaml`。                 |
| `apps/server/test/openapi/registry.test.ts` | 断言 doc 合法 + 范围守卫（含纳入路径、不含 auth/projects/tokens/stream）。        |
| `docs/api/openapi.yaml`                     | 生成物，入库。                                                                    |
| `docs/api/README.md`                        | 改：指向 openapi.yaml，标注 SSE/范围。                                            |
| `.github/workflows/ci.yml`                  | 加并行 `openapi-drift` job。                                                      |
| `pnpm-lock.yaml`                            | 依赖更新。                                                                        |

任务顺序：Task 1 依赖 + registry + 纯函数（带单测）→ Task 2 CLI 生成 + 提交 openapi.yaml → Task 3 README 更新 → Task 4 CI 漂移 job → Task 5 全量验证。

---

## Task 1: 依赖 + registry + `buildOpenApiDocument()`（TDD）

注册 4 个公开端点并以纯函数产出 OpenAPI 文档对象，先用单测锁定其形状。

**Files:**

- Modify: `apps/server/package.json`
- Create: `apps/server/src/openapi/registry.ts`
- Test: `apps/server/test/openapi/registry.test.ts`

- [ ] **Step 1: 装依赖**

Run:

```bash
cd /Users/fooevr/Code/argus
pnpm --filter @argus/server add '@asteasolutions/zod-to-openapi@^7.3.4' 'yaml@^2.5.0'
```

Expected: 安装成功。确认版本是 7.x（不是 8.x）：

```bash
node -e "console.log(require('@asteasolutions/zod-to-openapi/package.json').version)" 2>/dev/null \
 || pnpm --filter @argus/server exec node -e "console.log(require('@asteasolutions/zod-to-openapi/package.json').version)"
```

Expected: `7.3.4`（或其它 7.x）。若装成了 8.x，显式降级：`pnpm --filter @argus/server add '@asteasolutions/zod-to-openapi@7.3.4'`。

- [ ] **Step 2: 写失败测试**

Create `apps/server/test/openapi/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../../src/openapi/registry.js'

describe('buildOpenApiDocument', () => {
  const doc = buildOpenApiDocument()

  it('is a valid OpenAPI 3 document', () => {
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.info.title).toBeTruthy()
    expect(doc.info.version).toBeTruthy()
  })

  it('includes exactly the public-API paths', () => {
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual([
      '/api/sessions',
      '/api/sessions/{sessionId}',
      '/healthz',
      '/v1/traces',
    ])
  })

  it('describes POST /v1/traces with a JSON request body', () => {
    const op = (doc.paths!['/v1/traces'] as Record<string, any>).post
    expect(op).toBeTruthy()
    expect(op.requestBody.content['application/json'].schema).toBeTruthy()
    expect(op.responses['200']).toBeTruthy()
  })

  it('describes GET /api/sessions with a 200 JSON response and query params', () => {
    const op = (doc.paths!['/api/sessions'] as Record<string, any>).get
    expect(op.responses['200'].content['application/json'].schema).toBeTruthy()
    const names = (op.parameters ?? []).map((p: any) => p.name)
    expect(names).toContain('limit')
    expect(names).toContain('projectId')
  })

  it('describes GET /api/sessions/{sessionId} with a path param', () => {
    const op = (doc.paths!['/api/sessions/{sessionId}'] as Record<string, any>).get
    const names = (op.parameters ?? []).map((p: any) => p.name)
    expect(names).toContain('sessionId')
  })

  it('excludes internal endpoints (auth, projects, tokens, SSE stream)', () => {
    const paths = Object.keys(doc.paths ?? {})
    expect(paths.some((p) => p.startsWith('/auth'))).toBe(false)
    expect(paths.some((p) => p.includes('/projects'))).toBe(false)
    expect(paths.some((p) => p.includes('/tokens'))).toBe(false)
    expect(paths.some((p) => p.includes('/stream'))).toBe(false)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --filter @argus/server exec vitest run test/openapi/registry.test.ts`
Expected: FAIL —「Failed to resolve import '../../src/openapi/registry.js'」（模块还不存在）。

- [ ] **Step 4: 写 registry.ts**

Create `apps/server/src/openapi/registry.ts`:

```ts
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { ListSessionsResponseSchema, GetSessionResponseSchema } from '@argus/shared-types'
import { otlpExportRequestSchema } from '../modules/ingest/index.js'

// Adds .openapi() to the shared zod instance. Safe: server and shared-types
// resolve the SAME zod (pnpm-deduped), so imported schemas work too.
extendZodWithOpenApi(z)

/**
 * Build the OpenAPI 3 document for Argus's PUBLIC API surface.
 * Pure function — no filesystem, no server. The CLI serializes its output.
 *
 * Scope (see spec): ingest + read-only sessions + healthz. Auth/projects/tokens
 * (internal web-app API) and the SSE stream are intentionally excluded.
 */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry()

  registry.registerPath({
    method: 'post',
    path: '/v1/traces',
    summary: 'Ingest OpenTelemetry traces (OTLP/HTTP-JSON)',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: otlpExportRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'Accepted',
        content: { 'application/json': { schema: z.object({ accepted: z.number().int() }) } },
      },
      400: { description: 'Invalid OTLP payload' },
      401: { description: 'Unauthenticated (multi-tenant mode)' },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/sessions',
    summary: 'List sessions, most recently started first',
    request: {
      query: z.object({
        limit: z.string().optional(),
        projectId: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Session summaries',
        content: { 'application/json': { schema: ListSessionsResponseSchema } },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/sessions/{sessionId}',
    summary: 'Get one session with its steps',
    request: { params: z.object({ sessionId: z.string() }) },
    responses: {
      200: {
        description: 'Session detail',
        content: { 'application/json': { schema: GetSessionResponseSchema } },
      },
      404: { description: 'Not found' },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/healthz',
    summary: 'Liveness check',
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
      },
    },
  })

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Argus API',
      version: '0.0.0',
      description:
        'Public ingest and read-only session API. See docs/conventions/semantic-conventions.md.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local dev' }],
  })
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @argus/server exec vitest run test/openapi/registry.test.ts`
Expected: PASS（6 个用例全绿）。

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @argus/server exec tsc --noEmit`
Expected: exit 0。

- [ ] **Step 7: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/server/package.json pnpm-lock.yaml apps/server/src/openapi/registry.ts apps/server/test/openapi/registry.test.ts
git commit -m "feat(server): openapi registry for public api (zod-to-openapi v7)"
```

---

## Task 2: CLI 生成 + 提交 openapi.yaml

把文档对象序列化为 YAML 写入 `docs/api/openapi.yaml`，并入库。

**Files:**

- Create: `apps/server/src/cli/gen-openapi.ts`
- Modify: `apps/server/package.json`（加脚本）
- Create: `docs/api/openapi.yaml`（生成物）

- [ ] **Step 1: 写 CLI**

Create `apps/server/src/cli/gen-openapi.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { buildOpenApiDocument } from '../openapi/registry.js'

// apps/server/src/cli/ -> repo root is four levels up.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')
const outPath = resolve(repoRoot, 'docs/api/openapi.yaml')

const doc = buildOpenApiDocument()
const yaml = stringify(doc)
const banner = '# GENERATED by `pnpm --filter @argus/server gen:openapi` — do not edit by hand.\n'
writeFileSync(outPath, banner + yaml)
console.log(`Wrote ${outPath} (${yaml.length} bytes)`)
```

- [ ] **Step 2: 加 package.json 脚本**

在 `apps/server/package.json` 的 `scripts` 里加一行（放在现有脚本之间，保持 JSON 合法）：

```json
    "gen:openapi": "tsx src/cli/gen-openapi.ts",
```

- [ ] **Step 3: 生成**

Run: `pnpm --filter @argus/server gen:openapi`
Expected: 打印 `Wrote .../docs/api/openapi.yaml (...)`，文件生成。

校验是合法 OpenAPI YAML 且含期望 path：

```bash
cd /Users/fooevr/Code/argus
node -e "const y=require('yaml');const fs=require('fs');const d=y.parse(fs.readFileSync('docs/api/openapi.yaml','utf8'));console.log('openapi',d.openapi);console.log('paths',Object.keys(d.paths).sort())"
```

Expected: `openapi 3.0.3` 且 `paths [ '/api/sessions', '/api/sessions/{sessionId}', '/healthz', '/v1/traces' ]`。

> 注：上面的 node 命令从仓库根用根 node_modules 的 `yaml`——若根没有 `yaml`，改用 `pnpm --filter @argus/server exec node -e "..."`（同样逻辑，但 cwd 在 apps/server，路径改成 `../../docs/api/openapi.yaml`）。

- [ ] **Step 4: 幂等性自检**

Run:

```bash
cd /Users/fooevr/Code/argus
pnpm --filter @argus/server gen:openapi
git diff --stat docs/api/openapi.yaml
```

Expected: 第二次生成后 `git diff` 为空（生成物稳定/幂等）。

- [ ] **Step 5: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/server/src/cli/gen-openapi.ts apps/server/package.json docs/api/openapi.yaml
git commit -m "feat(server): cli to generate docs/api/openapi.yaml"
```

> 预提交钩子会 prettier 格式化 `docs/api/openapi.yaml`（.yaml 在 glob 内）。**这会带来一个隐患**：若 prettier 重排了 yaml，下次 `gen:openapi` 产出的（未经 prettier 的）内容会与提交版不一致 → 漂移检查误报。**对策见 Task 4 Step 1**：CI 漂移检查比对前也跑同一套 prettier，或在 lint-staged 忽略该生成文件。本任务提交后，立即执行 Task 4 Step 0 验证两者一致。

---

## Task 3: 更新 docs/api/README.md

把 aspirational 文案换成指向真实产物。

**Files:**

- Modify: `docs/api/README.md`

- [ ] **Step 1: 重写 README**

把 `docs/api/README.md` 整个替换为：

```markdown
# Argus HTTP API

The OpenAPI 3 spec for Argus's **public API** (trace ingest + read-only session
read) is generated from the Zod schemas in `apps/server` and committed here:

- [`openapi.yaml`](./openapi.yaml) — generated by `pnpm --filter @argus/server gen:openapi`; CI fails if it drifts from the schemas.

Scope: `POST /v1/traces`, `GET /api/sessions`, `GET /api/sessions/{sessionId}`,
`GET /healthz`. The internal web-app API (auth, projects, tokens) is not part of
the published spec.

The SSE protocol for `GET /api/sessions/:id/stream` is documented separately in
`sse-protocol.md` (text/event-stream doesn't fit OpenAPI well).

For the trace attribute contract clients must follow, see
[`../conventions/semantic-conventions.md`](../conventions/semantic-conventions.md).
```

- [ ] **Step 2: 提交**

```bash
cd /Users/fooevr/Code/argus
git add docs/api/README.md
git commit -m "docs(api): point README at generated openapi.yaml"
```

---

## Task 4: CI 漂移检查 job

CI 重新生成 spec 并对比已提交版本，确保不漂移。

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 0: 先确认本地"prettier 后的提交版"与"裸生成版"一致（防 Task 2 的隐患）**

Run:

```bash
cd /Users/fooevr/Code/argus
pnpm --filter @argus/server gen:openapi
git diff --exit-code docs/api/openapi.yaml; echo "DIFF_EXIT=$?"
```

- 若 `DIFF_EXIT=0`：裸生成与提交版一致，CI 用简单的 `git diff --exit-code` 即可（走 Step 1A）。
- 若 `DIFF_EXIT=1`：prettier 改了生成物。则把 `docs/api/openapi.yaml` 加入 lint-staged 忽略，统一以"裸生成"为准——编辑 `lint-staged.config.cjs`，把生成文件排除（走 Step 1B）。

- [ ] **Step 1A（DIFF_EXIT=0 时）: 追加 openapi-drift job**

在 `.github/workflows/ci.yml` 末尾追加（与现有 job 同级，两空格缩进，原样复制）：

```text
  openapi-drift:
    name: openapi · drift check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Regenerate OpenAPI spec
        run: pnpm --filter @argus/server gen:openapi

      - name: Fail if the committed spec is stale
        run: git diff --exit-code docs/api/openapi.yaml
```

- [ ] **Step 1B（仅 DIFF_EXIT=1 时）: 先让 lint-staged 忽略生成文件，再追加同上的 job**

编辑 `lint-staged.config.cjs`，把 `docs/api/openapi.yaml` 从 prettier 处理中排除。当前内容：

```js
module.exports = {
  '*.{ts,tsx,js,jsx}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,yml,yaml,css}': ['prettier --write'],
}
```

改为（用函数形式过滤掉生成文件）：

```js
module.exports = {
  '*.{ts,tsx,js,jsx}': ['eslint --fix', 'prettier --write'],
  '*.{json,md,yml,yaml,css}': (files) => {
    const filtered = files.filter((f) => !f.endsWith('docs/api/openapi.yaml'))
    return filtered.length ? [`prettier --write ${filtered.join(' ')}`] : []
  },
}
```

然后重新 `pnpm --filter @argus/server gen:openapi` + `git add docs/api/openapi.yaml lint-staged.config.cjs` + 修订 Task 2 的提交（或新提交 `chore: exclude generated openapi.yaml from prettier`）。再追加与 1A 相同的 `openapi-drift` job。

- [ ] **Step 2: 校验 YAML 有 5 个 job**

Run:

```bash
cd /Users/fooevr/Code/argus
python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print('jobs:', list(d['jobs'].keys()))"
```

Expected: `jobs: ['ci', 'docs-links', 'docs-build', 'openapi-drift']`

- [ ] **Step 3: 提交**

```bash
cd /Users/fooevr/Code/argus
git add .github/workflows/ci.yml
git commit -m "ci: fail on stale generated openapi.yaml"
```

---

## Task 5: 全量验证

**Files:** 无（仅命令）。

- [ ] **Step 1: 漂移检查能抓到漂移（临时改 schema 不重新生成）**

临时给 ingest 的 OTLP 响应加个字段——编辑 `apps/server/src/openapi/registry.ts`，把 `/v1/traces` 的 200 响应 schema 从 `z.object({ accepted: z.number().int() })` 改成 `z.object({ accepted: z.number().int(), extra: z.string() })`。**不**重新生成，然后：

```bash
cd /Users/fooevr/Code/argus
pnpm --filter @argus/server gen:openapi
git diff --exit-code docs/api/openapi.yaml; echo "DRIFT_EXIT=$?"
```

Expected: `DRIFT_EXIT=1`（生成物与提交版不一致——正是 CI 会拦的）。

然后**撤销**临时改动并重新生成回到干净态：

```bash
cd /Users/fooevr/Code/argus
git checkout apps/server/src/openapi/registry.ts
pnpm --filter @argus/server gen:openapi
git diff --exit-code docs/api/openapi.yaml; echo "CLEAN_EXIT=$?"
```

Expected: `CLEAN_EXIT=0`（撤销后生成物与提交版一致）。

- [ ] **Step 2: 全量回归**

Run:

```bash
cd /Users/fooevr/Code/argus
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

Expected: 全绿。新测试 `registry.test.ts` 在 server 套件内通过。

- [ ] **Step 3: 最终状态**

Run:

```bash
cd /Users/fooevr/Code/argus
git status --short
git --no-pager log --oneline -6
```

Expected: working tree 仅余既有噪声（`.idea/`、`seed-tmp.ts`、`.tanstack/`、`routeTree.gen.ts`）；最近提交对应 Task 1–4。

---

## Self-Review

**Spec 覆盖：**

- 范围（4 个公开端点，排除 auth/projects/tokens/SSE）→ Task 1 registry + 范围守卫测试 ✓
- zod-to-openapi v7（非 v8）+ 复用 shared-types schema 不改源 → Task 1 Step 1/4 ✓
- 生成 openapi.yaml 入库 → Task 2 ✓
- README 更新 → Task 3 ✓
- 防腐"重新生成 + git diff"→ Task 4（含 prettier-vs-生成物 一致性处理）✓
- 测试（合法性 + 范围守卫）→ Task 1 Step 2 ✓
- 验收（幂等、漂移可抓、回归）→ Task 2 Step 4 / Task 5 ✓

**占位符扫描：** 无 TBD/TODO；每步给完整代码/命令/期望输出。Task 4 的 1A/1B 分支是对实测隐患（prettier 重排生成物）的有界条件处理，非占位。✓

**类型/标识一致性：** `buildOpenApiDocument()` 在 Task 1 定义、Task 2 CLI 与 Task 1 测试都用同名；导入 `ListSessionsResponseSchema`/`GetSessionResponseSchema`/`otlpExportRequestSchema` 均为勘察确认存在的导出；路径 `apps/server/src/cli/` → repoRoot 上溯四级与 Task 1 的 example-trace 测试同款已验证；依赖版本 `^7.3.4` 全程一致。✓
