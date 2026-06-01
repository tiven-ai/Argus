# 门户部署到 GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把三语 VitePress 门户发布到 GitHub Pages（`https://tiven-ai.github.io/Argus/`）：加条件 base + 独立 deploy.yml + 给用户的启用说明。

**Architecture:** `apps/docs/.vitepress/config.ts` 用 `process.env.GITHUB_ACTIONS` 切换 base（CI→`/Argus/`，本地→`/`）。新建 `.github/workflows/deploy.yml`（VitePress 官方 Pages 工作流，pnpm/Node20 适配），push main + 手动触发，build → upload-pages-artifact → deploy-pages。现有 `ci.yml` 不动。

**Tech Stack:** VitePress 1.6.4 + GitHub Pages（`actions/configure-pages@v5` / `upload-pages-artifact@v3` / `deploy-pages@v4`）+ pnpm 10 / Node 20。

**Spec:** `docs/superpowers/specs/2026-06-01-portal-deploy-design.md`

**已实测确认（写计划前在真仓库验证）：**

- 在 config.ts 加 `base: process.env.GITHUB_ACTIONS ? '/Argus/' : '/'` 后：`GITHUB_ACTIONS=true pnpm --filter @argus/docs build` 的产物 `index.html` 资源前缀为 `/Argus/assets`，内部链接为 `/Argus/content/integration/sending-traces.html`（VitePress 自动给相对链接加 base）；裸 `pnpm --filter @argus/docs build` 资源前缀为 `/assets`、链接为 `/content/...`。两向都对。

**命令约定：** 构建 `pnpm --filter @argus/docs build`；CI 模拟 `GITHUB_ACTIONS=true pnpm --filter @argus/docs build`。提交遵循 commitlint。预提交钩子格式化 `*.{json,md,yml,yaml,css}`——`.ts` 不在 glob。不要 `--no-verify`。

> 诚实边界：本计划交付 workflow + 条件 base + 启用说明。**启用仓库 Pages 设置（Settings → Pages → Source: GitHub Actions）与线上 URL 核对需用户在 GitHub 侧完成**——无法从此环境做。

---

## File Structure

| 文件                             | 角色                                       |
| -------------------------------- | ------------------------------------------ |
| `apps/docs/.vitepress/config.ts` | 改。顶层加条件 `base`。                    |
| `.github/workflows/deploy.yml`   | 新增。Pages 部署工作流（build + deploy）。 |
| `README.md`                      | 改。加 "Deploying the docs portal" 小节。  |

任务顺序：Task 1 条件 base → Task 2 deploy.yml → Task 3 README 说明 → Task 4 验证。

---

## Task 1: 条件 base

**Files:** Modify `apps/docs/.vitepress/config.ts`

- [ ] **Step 1: 加 base**

在 `apps/docs/.vitepress/config.ts` 的 `defineConfig({...})` 顶层，把现有：

```ts
export default defineConfig({
  title: 'Argus',
  description: 'Observability for AI agents',
```

改为（在 `description` 后插入 base + 说明注释）：

```ts
export default defineConfig({
  title: 'Argus',
  description: 'Observability for AI agents',

  // GitHub Pages serves this project site under /Argus/. Use that base only in
  // CI (GITHUB_ACTIONS is set by the runner); local dev/build stay at '/'.
  base: process.env.GITHUB_ACTIONS ? '/Argus/' : '/',
```

其余键（`vite`/`srcExclude`/`ignoreDeadLinks`/`themeConfig`/`locales`）原样不动。

- [ ] **Step 2: 验证两向 base**

```bash
cd /Users/fooevr/Code/argus
rm -rf apps/docs/.vitepress/dist apps/docs/.vitepress/cache
GITHUB_ACTIONS=true pnpm --filter @argus/docs build >/dev/null 2>&1
echo "--- CI build (expect /Argus/) ---"
grep -oE '(href|src)="/[^"]*"' apps/docs/.vitepress/dist/index.html | grep -oE '/(Argus/)?assets' | sort -u
grep -oE 'href="/Argus/[^"]*sending-traces[^"]*"' apps/docs/.vitepress/dist/index.html | head -1
rm -rf apps/docs/.vitepress/dist apps/docs/.vitepress/cache
pnpm --filter @argus/docs build >/dev/null 2>&1
echo "--- bare build (expect /) ---"
grep -oE '(href|src)="/[^"]*"' apps/docs/.vitepress/dist/index.html | grep -oE '/(Argus/)?assets' | sort -u
```

Expected: CI build 打印 `/Argus/assets` 与一条 `/Argus/...sending-traces.html`；bare build 打印 `/assets`（无 `/Argus/`）。

- [ ] **Step 3: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/docs/.vitepress/config.ts
git commit -m "feat(docs): conditional base for github pages subpath"
```

---

## Task 2: deploy.yml

**Files:** Create `.github/workflows/deploy.yml`

- [ ] **Step 1: 写 workflow**

Create `.github/workflows/deploy.yml` with EXACTLY:

```yaml
# Deploy the VitePress docs portal (apps/docs) to GitHub Pages.
# Enable once in repo Settings → Pages → Source: GitHub Actions. See README.
name: Deploy VitePress site to Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Allow one concurrent deployment; don't cancel an in-progress production deploy.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
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

      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build docs portal
        run: pnpm --filter @argus/docs build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: apps/docs/.vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: 校验 YAML 合法 + 结构**

```bash
cd /Users/fooevr/Code/argus
python3 -c "
import yaml
d = yaml.safe_load(open('.github/workflows/deploy.yml'))
print('jobs:', list(d['jobs'].keys()))
print('perms:', d['permissions'])
print('triggers:', list(d[True].keys()))   # 'on' parses as boolean True key in YAML
print('artifact path:', d['jobs']['build']['steps'][-1]['with']['path'])
print('deploy needs:', d['jobs']['deploy']['needs'])
"
```

Expected: `jobs: ['build', 'deploy']`；`perms` 含 `pages: write` + `id-token: write` + `contents: read`；`triggers` 含 `push` 与 `workflow_dispatch`；`artifact path: apps/docs/.vitepress/dist`；`deploy needs: build`。

> 注：YAML 把 `on:` 解析成布尔键 `True`，故上面用 `d[True]`。这是 PyYAML 的已知行为，不是错误。

- [ ] **Step 3: 确认 ci.yml 未被触碰**

```bash
cd /Users/fooevr/Code/argus
git status --short .github/workflows/ci.yml
```

Expected: 无输出（ci.yml 未改）。

- [ ] **Step 4: 提交**

```bash
cd /Users/fooevr/Code/argus
git add .github/workflows/deploy.yml
git commit -m "ci: deploy docs portal to github pages"
```

预提交钩子会 prettier 格式化 yaml——格式化后**重跑 Step 2** 确认 jobs 仍是 `build`+`deploy`；若 prettier 破坏结构则修正缩进再提交。

---

## Task 3: README 启用说明

**Files:** Modify `README.md`

- [ ] **Step 1: 读 README 找插入点**

Run: `cd /Users/fooevr/Code/argus && grep -n '^## ' README.md`
找到 "Repository layout" 或文档相关小节的位置，把新小节插在合适处（如紧接 quickstart/trace 发送说明之后、Repository layout 之前；具体看实际结构择优）。

- [ ] **Step 2: 加 "Deploying the docs portal" 小节**

在选定位置插入：

```markdown
## Deploying the docs portal

The docs portal (`apps/docs`, VitePress) auto-deploys to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on every push to
`main` (or manually from the Actions tab).

**One-time setup:** in the repo's **Settings → Pages → Build and deployment →
Source**, choose **GitHub Actions**. After that, the site publishes to
<https://tiven-ai.github.io/Argus/>.

Locally: `pnpm --filter @argus/docs dev`.
```

- [ ] **Step 3: 提交**

```bash
cd /Users/fooevr/Code/argus
git add README.md
git commit -m "docs: how to enable github pages deployment"
```

---

## Task 4: 全量验证

**Files:** 无（仅命令）。

- [ ] **Step 1: README 新链接可解析**

```bash
cd /Users/fooevr/Code/argus
test -f .github/workflows/deploy.yml && echo "deploy.yml link OK"
```

Expected: `deploy.yml link OK`（README 里 `.github/workflows/deploy.yml` 链接指向真实文件）。

- [ ] **Step 2: CI 模拟构建（部署 workflow 会跑的命令）**

```bash
cd /Users/fooevr/Code/argus
rm -rf apps/docs/.vitepress/dist apps/docs/.vitepress/cache
GITHUB_ACTIONS=true pnpm --filter @argus/docs build >/dev/null 2>&1; echo "CI_BUILD=$?"
test -f apps/docs/.vitepress/dist/index.html && echo "artifact present"
test -f apps/docs/.vitepress/dist/zh/index.html && test -f apps/docs/.vitepress/dist/ja/index.html && echo "all locales present"
```

Expected: `CI_BUILD=0`、`artifact present`、`all locales present`（部署上传的就是这个 dist）。

- [ ] **Step 3: 回归（既有不受影响）**

```bash
cd /Users/fooevr/Code/argus
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

Expected: 全绿。注意根 `pnpm build` 不带 `GITHUB_ACTIONS`，故 docs 以 `/` base 构建——本地/turbo 一致。

- [ ] **Step 4: docs-links / docs-build CI job 不受影响确认**

```bash
cd /Users/fooevr/Code/argus
python3 -c "import yaml;print('ci jobs:',list(yaml.safe_load(open('.github/workflows/ci.yml'))['jobs'].keys()))"
git --no-pager diff main -- .github/workflows/ci.yml
```

Expected: `ci jobs: ['ci', 'docs-links', 'docs-build', 'openapi-drift']`（4 个不变）；ci.yml 与 main 无 diff。

- [ ] **Step 5: 最终状态**

```bash
cd /Users/fooevr/Code/argus
git status --short
git --no-pager log --oneline -4
```

Expected: working tree 仅余既有噪声；最近提交对应 Task 1–3。

---

## Self-Review

**Spec 覆盖：** 条件 base（`GITHUB_ACTIONS ? '/Argus/' : '/'`）→ Task1 ✓；独立 deploy.yml（push main + dispatch、pages/id-token 权限、concurrency、build+deploy、artifact path）→ Task2 ✓；README 启用说明（Settings→Pages→GitHub Actions + URL）→ Task3 ✓；验证（两向 base、CI 模拟构建产 artifact、回归、ci.yml 不动）→ Task4 ✓；诚实边界（启用 Pages 设置 + 线上核对归用户）→ header + Task3 说明 ✓。

**占位符扫描：** 无 TBD/TODO；config 编辑、整个 deploy.yml、README 小节均给完整内容；命令带期望输出。✓

**一致性：** base 值 `/Argus/`（= 仓库名）与 Pages URL `tiven-ai.github.io/Argus/` 一致；artifact path `apps/docs/.vitepress/dist` 与门户 outDir 一致；action 版本（configure-pages@v5 / upload-pages-artifact@v3 / deploy-pages@v4 / checkout@v4 / setup-node@v4 / pnpm action-setup@v4）与 spec 及现有 ci.yml 约定一致；Node 20 / pnpm 10 与仓库一致。✓
