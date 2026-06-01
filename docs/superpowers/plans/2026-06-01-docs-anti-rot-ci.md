# 文档防腐 CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `docs/README.md` 的两条可自动化维护规则变成 CI 门禁——示例 payload 有效性（vitest smoke test，专治 "7→6" 漂移）与文档内部死链检查（lychee，离线）。

**Architecture:** 两个独立单元。(A) 一个纯解析 vitest 测试放进现有 `apps/server` 套件，读 `scripts/example-trace.json` 用真实 ingest 解析器校验、并与文档声称的 `accepted` 数交叉比对——随现有 `pnpm test` 跑，无需改 CI 的 test 步骤。(B) `.github/workflows/ci.yml` 新增一个与现有 `ci` 并行的 `docs-links` job，用 lychee 离线检查仓库内部相对链接，配置写在仓库根 `lychee.toml`。

**Tech Stack:** TypeScript + Vitest（`apps/server`，ESM、`import.meta.url` 定位文件）+ GitHub Actions + `lycheeverse/lychee-action@v2`。

**Spec:** `docs/superpowers/specs/2026-06-01-docs-anti-rot-ci-design.md`

**命令约定：**

- 跑 server 全套测试：`pnpm --filter @argus/server test`（globalSetup 会用 testcontainer 起一个 Postgres——需要 Docker 可用；新测试本身不碰 DB）
- 跑单个测试文件：`pnpm --filter @argus/server exec vitest run test/docs/example-trace.test.ts`（仍会触发 globalSetup，较慢但可用）
- 本地链接检查（需 Docker）：见 Task 2

> 提交信息遵循 conventional commits + commitlint（subject 小写、句首非大写）。`git add` 路径相对仓库根 `/Users/fooevr/Code/argus`。预提交钩子（lint-staged + prettier）可能重排格式，属正常；不要用 `--no-verify`。

---

## File Structure

| 文件                                          | 角色                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/server/test/docs/example-trace.test.ts` | **新增**。示例 OTLP 合法性 + 真实解析 span 数 + 与文档 `accepted` 数交叉校验。 |
| `lychee.toml`                                 | **新增**（仓库根）。lychee 离线检查配置。                                      |
| `.github/workflows/ci.yml`                    | **修改**。在末尾追加并行 job `docs-links`。现有 `ci` job 一字不动。            |

不动产品代码、不动文档内容、不动现有 `ci` job 步骤。

任务顺序：Task 1（示例 smoke test）→ Task 2（死链 CI）。两者无相互依赖，但按此序执行便于分别验证。

---

## Task 1: 示例 payload smoke test

读 `scripts/example-trace.json`，用真实的 ingest 解析器校验它合法、可解析，并断言文档里写的 `accepted` 数与示例实际 span 数一致。

**Files:**

- Create / Test: `apps/server/test/docs/example-trace.test.ts`

> 这是一个不变量测试：当前仓库状态下它应当**直接通过**（文档写 6、示例 6 个 span）。TDD 的"看它失败"通过在 Step 3 临时把文档数字改错来体现——证明它真能抓到漂移。

- [ ] **Step 1: 写测试文件**

Create `apps/server/test/docs/example-trace.test.ts` with EXACTLY:

```ts
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { otlpExportRequestSchema, parseOtlpRequest } from '../../src/modules/ingest/index.js'

// This test file lives at apps/server/test/docs/; the repo root is four levels up.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')
const examplePath = resolve(repoRoot, 'scripts/example-trace.json')
const guidePath = resolve(repoRoot, 'docs/integration/sending-traces.md')

describe('docs: example-trace.json stays valid and in sync with the integration guide', () => {
  it('is a valid OTLP request the real parser accepts', () => {
    const json = JSON.parse(readFileSync(examplePath, 'utf8'))
    const parsed = otlpExportRequestSchema.parse(json) // throws if the schema moved on
    const results = parseOtlpRequest(parsed)
    const spanCount = results.reduce((n, r) => n + r.steps.length, 0)
    expect(spanCount).toBeGreaterThan(0)
  })

  it('matches the accepted count documented in the integration guide', () => {
    const json = JSON.parse(readFileSync(examplePath, 'utf8'))
    const parsed = otlpExportRequestSchema.parse(json)
    const actualSpanCount = parseOtlpRequest(parsed).reduce((n, r) => n + r.steps.length, 0)

    const md = readFileSync(guidePath, 'utf8')
    // The guide shows the success body once as `{ "accepted": <number> }`.
    // The at-a-glance table uses `<span-count>` (non-numeric) and is not matched.
    const matches = [...md.matchAll(/"accepted"\s*:\s*(\d+)/g)]
    expect(matches).toHaveLength(1)
    const documented = Number(matches[0]![1])

    expect(documented).toBe(actualSpanCount)
  })
})
```

- [ ] **Step 2: 跑测试，确认通过（当前不变量成立）**

Run: `pnpm --filter @argus/server exec vitest run test/docs/example-trace.test.ts`
Expected: PASS（2 个用例绿）。注意 globalSetup 会先用 testcontainer 起 Postgres，可能等十几秒——这是套件配置，新测试本身不用 DB。

- [ ] **Step 3: 证明它能抓到漂移（临时改坏文档）**

临时把 `docs/integration/sending-traces.md` 里的 `{ "accepted": 6 }` 改成 `{ "accepted": 7 }`（就是当初那个真实 bug）。

Run: `pnpm --filter @argus/server exec vitest run test/docs/example-trace.test.ts`
Expected: FAIL —— 第二个用例报 `expected 7 to be 6`（或 `expected 6 to be 7`，取决于断言方向；总之红）。

然后**改回** `6`：

Run: `pnpm --filter @argus/server exec vitest run test/docs/example-trace.test.ts`
Expected: PASS（恢复绿）。确认 `git diff docs/integration/sending-traces.md` 为空——文档未被改动。

- [ ] **Step 4: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/server/test/docs/example-trace.test.ts
git commit -m "test(server): smoke-test example-trace.json against the integration guide"
```

---

## Task 2: 死链检查 CI job

新增 `lychee.toml` 与一个并行 CI job，离线检查 `docs/**/*.md` 与根 `README.md` 的内部相对链接。

**Files:**

- Create: `lychee.toml`
- Modify: `.github/workflows/ci.yml`（在文件末尾追加一个新 job）

- [ ] **Step 1: 写 lychee.toml**

Create `lychee.toml` (repo root) with EXACTLY:

```toml
# Anti-rot internal-link check. See docs/superpowers/specs/2026-06-01-docs-anti-rot-ci-design.md
#
# Offline: only verify that links resolve to real local files. We do NOT check
# whether external URLs are reachable — that causes flaky failures on third-party
# downtime, and is not what this gate is for.
offline = true
no_progress = true
```

- [ ] **Step 2: 本地用 Docker 跑一遍 lychee，确认现有文档无死链**

Run:

```bash
cd /Users/fooevr/Code/argus
docker run --rm -v "$PWD:/input" -w /input lycheeverse/lychee:latest \
  --config lychee.toml './docs/**/*.md' './README.md'
```

Expected: 退出码 0，输出末尾类似 `0 errors`（所有相对链接解析成功；外部 URL 在 offline 模式下被跳过）。

> 若拉取镜像失败或本机无 Docker，跳过本地检查——以 Step 4 推分支后 CI 的 `docs-links` job 为权威验证。但优先本地验证。

- [ ] **Step 3: 在 ci.yml 末尾追加并行 job**

打开 `.github/workflows/ci.yml`。当前它只有一个 `jobs.ci`。在文件**最末尾**（`ci` job 的最后一行 `run: pnpm build` 之后）追加下面的内容。下方代码块**已经带好正确缩进**（`docs-links:` 行首两个空格，与现有 `ci:` 同级），原样复制、保持前导空格即可。先空一行再粘贴：

```text
  docs-links:
    name: docs · dead-link check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check internal doc links
        uses: lycheeverse/lychee-action@v2
        with:
          args: --config lychee.toml './docs/**/*.md' './README.md'
          fail: true
```

注意：这是 `jobs:` 下的第二个 job，`docs-links:` 与 `ci:` 行首都是两个空格。不要改动 `ci` job 的任何内容，也不要动顶部的 `on:` / `concurrency:`。粘贴后用 Step 4 校验缩进正确。

- [ ] **Step 4: 校验 workflow YAML 合法**

Run:

```bash
cd /Users/fooevr/Code/argus
node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); const m=y.match(/^  [a-z-]+:/gm); console.log('top-level jobs:', m)"
```

Expected: 打印出包含 `  ci:` 与 `  docs-links:` 两项（其余 `  steps:` 等更深缩进不会被这个只匹配两空格行首的正则命中——若担心可改用 `python -c` 或 `yq`，但这个快速检查足以确认两个 job 键存在且同级）。

更稳妥（若环境有 Python）：

```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); print('jobs:', list(d['jobs'].keys()))"
```

Expected: `jobs: ['ci', 'docs-links']`

- [ ] **Step 5: 证明它能抓到死链（临时加坏链接）**

在 `docs/integration/README.md` 末尾临时加一行指向不存在文件的相对链接：

```bash
cd /Users/fooevr/Code/argus
printf '\n[broken](./does-not-exist.md)\n' >> docs/integration/README.md
docker run --rm -v "$PWD:/input" -w /input lycheeverse/lychee:latest \
  --config lychee.toml './docs/**/*.md' './README.md'
echo "exit=$?"
```

Expected: 非零退出码，错误列表里出现 `does-not-exist.md`。

然后**撤销**这行：

```bash
git checkout docs/integration/README.md
```

确认 `git diff docs/integration/README.md` 为空。

> 若本机无 Docker，跳过本地这步——CI 的 `docs-links` job 会在 PR 上执行同样的检查。

- [ ] **Step 6: 提交**

```bash
cd /Users/fooevr/Code/argus
git add lychee.toml .github/workflows/ci.yml
git commit -m "ci: add offline dead-link check for docs"
```

---

## Task 3: 全量回归

确认新测试与现有套件一起绿，且其余检查不受影响。

**Files:** 无（仅运行命令）。

- [ ] **Step 1: 跑 server 全套测试**

Run: `pnpm --filter @argus/server test`
Expected: 全部 PASS，包含新的 `test/docs/example-trace.test.ts`。

- [ ] **Step 2: 顺带确认其它包未受影响**

Run: `pnpm test`
Expected: 所有包测试 PASS（turbo 跑 server + web 等）。

- [ ] **Step 3: lint / typecheck / build 不受影响**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: 三者均成功退出。新测试文件应通过 `apps/server` 的 `eslint src test`（test 在 lint 范围内）。

- [ ] **Step 4: 最终状态检查**

Run:

```bash
cd /Users/fooevr/Code/argus
git status --short
git --no-pager log --oneline -3
```

Expected: working tree 仅余既有未跟踪噪声（`.idea/`、`apps/server/seed-tmp.ts`、`apps/web/.tanstack/`、`apps/web/src/routeTree.gen.ts`）；最近两次提交为 Task 1、Task 2。

---

## Self-Review

**Spec 覆盖核对：**

- 单元 A 示例 smoke test（OTLP 合法性 + 真实解析 + 文档 accepted 交叉校验、单一真源从文档抓取、正则恰好一处匹配）→ Task 1 ✓
- 单元 B 死链检查（lychee、offline-only、scope=docs/\*\*+README、独立并行 job、配置入 lychee.toml）→ Task 2 ✓
- 不做项（不碰 OpenAPI、不查外部 URL、不做 md 风格 lint、不自动化流程纪律）→ 计划未触及，符合 ✓
- 验收标准（改 7 红/改 6 绿；坏链红/移除绿；pnpm test 通过；两 job 绿）→ Task 1 Step 3、Task 2 Step 5、Task 3 ✓

**占位符扫描：** 无 TBD/TODO；每个改文件步骤都给了完整代码或精确命令与期望输出。✓

**类型 / 标识一致性：** 测试用 `otlpExportRequestSchema` 与 `parseOtlpRequest`（与 `apps/server/src/modules/ingest/index.ts` 实际导出一致）；span 数公式 `results.reduce((n, r) => n + r.steps.length, 0)` 对应 `WriteTraceInput.steps`（`storage/types.ts:29`）；导入路径 `../../src/modules/ingest/index.js`、repo 根 `resolve(here, '../../../..')` 与文件实际位置 `apps/server/test/docs/` 对应。lychee 配置键 `offline` / `no_progress` 为 CLI 长选项的 snake_case 形式。✓

```

```
