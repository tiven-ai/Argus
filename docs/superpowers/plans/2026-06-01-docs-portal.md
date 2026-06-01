# 文档门户 Implementation Plan（VitePress + Unifi Console 主题）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `apps/docs/` 建一个 VitePress 门户，通过 `content/` symlink **直接渲染** 仓库 `docs/` 的真实 markdown（仅外部面向页），视觉复刻 Unifi Console（移植令牌 + CSS 重皮），本地可跑、CI 可构建。

**Architecture:** 新 pnpm 工作区 `@argus/docs`。VitePress root = `apps/docs`；用相对 symlink `apps/docs/content → ../../docs` 让真源文件落在 root 之内（严格 pnpm 下 root 之外的 md 无法解析 `vue/server-renderer`——已实测）。`srcExclude` 裁掉内部内容，`ignoreDeadLinks` 定向放行两个跨仓链接。主题用 `extends: DefaultTheme` + Layout wrapper，Console 观感主要靠把 `--vp-c-*` 映射到移植的 Unifi 令牌。

**Tech Stack:** VitePress 1.6.4 + Vue 3 + `@fontsource-variable/inter`；pnpm 10 / Node 20 / turbo；GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-06-01-docs-portal-design.md`

**命令约定：**

- 门户开发：`pnpm --filter @argus/docs dev`
- 门户构建：`pnpm --filter @argus/docs build`
- 安装依赖（加包后）：在仓库根 `pnpm install`

> 提交遵循 conventional commits + commitlint（subject 小写）。预提交钩子（lint-staged + prettier）会格式化 `*.{json,md,yml,yaml,css}`——`.vue`/`.ts` 不在其 glob 内，不会被改。不要 `--no-verify`。不碰 `apps/web`、`apps/server`、`packages/*`、`docs/` 既有内容。

---

## File Structure

| 文件                                     | 角色                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/docs/package.json`                 | 工作区清单。脚本 dev/build/preview；deps vitepress + vue + @fontsource-variable/inter。 |
| `apps/docs/.gitignore`                   | 忽略 `.vitepress/dist`、`.vitepress/cache`。                                            |
| `apps/docs/content`                      | 相对 symlink → `../../docs`（指向真源，git 里是链接不是副本）。                         |
| `apps/docs/index.md`                     | 门户首页（VitePress home layout）。                                                     |
| `apps/docs/.vitepress/config.ts`         | srcExclude / ignoreDeadLinks / nav / sidebar / 本地搜索 / 标题。                        |
| `apps/docs/.vitepress/theme/index.ts`    | extends DefaultTheme + Layout wrapper + import CSS + 字体。                             |
| `apps/docs/.vitepress/theme/Layout.vue`  | 包裹 `DefaultTheme.Layout`。                                                            |
| `apps/docs/.vitepress/theme/tokens.css`  | 移植 Unifi 令牌（`:root` + `.dark`）。                                                  |
| `apps/docs/.vitepress/theme/console.css` | VitePress 变量 → Unifi 令牌映射 + chrome 微调。                                         |
| `.github/workflows/ci.yml`               | 追加并行 `docs-build` job。                                                             |

任务顺序：Task 1 脚手架 + 跑通空构建 → Task 2 内容接入（symlink + 裁剪 + 死链）→ Task 3 Console 主题 → Task 4 首页 + 导航 → Task 5 CI + 全量验证。每个 Task 结束都应能 `build` 成功。

---

## Task 1: 脚手架 — 工作区 + 最小可构建的 VitePress

建立 `@argus/docs` 工作区与最小 VitePress 配置，先用一个本地占位首页跑通 `build`，确认工具链 OK（不涉及 symlink/主题）。

**Files:**

- Create: `apps/docs/package.json`
- Create: `apps/docs/.gitignore`
- Create: `apps/docs/index.md`
- Create: `apps/docs/.vitepress/config.ts`

- [ ] **Step 1: 写 package.json**

Create `apps/docs/package.json`:

```json
{
  "name": "@argus/docs",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev",
    "build": "vitepress build",
    "preview": "vitepress preview"
  },
  "devDependencies": {
    "vitepress": "1.6.4",
    "vue": "^3.5.0"
  },
  "dependencies": {
    "@fontsource-variable/inter": "^5.1.0"
  }
}
```

- [ ] **Step 2: 写 .gitignore**

Create `apps/docs/.gitignore`:

```
.vitepress/dist
.vitepress/cache
```

- [ ] **Step 3: 写占位首页**

Create `apps/docs/index.md`:

```markdown
# Argus Docs

Placeholder home — replaced in Task 4.
```

- [ ] **Step 4: 写最小 config**

Create `apps/docs/.vitepress/config.ts`:

```ts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Argus',
  description: 'Observability for AI agents',
})
```

- [ ] **Step 5: 安装依赖**

Run: `cd /Users/fooevr/Code/argus && pnpm install`
Expected: 安装成功，`apps/docs` 被 `apps/*` workspace glob 纳入；`pnpm-lock.yaml` 更新含 vitepress/vue。

- [ ] **Step 6: 跑通构建**

Run: `pnpm --filter @argus/docs build`
Expected: 构建成功，输出 `apps/docs/.vitepress/dist/index.html`。验证：`test -f apps/docs/.vitepress/dist/index.html && echo OK`。

- [ ] **Step 7: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/docs/package.json apps/docs/.gitignore apps/docs/index.md apps/docs/.vitepress/config.ts pnpm-lock.yaml
git commit -m "feat(docs): scaffold VitePress workspace"
```

> 注：`.vitepress/dist` 与 `cache` 已被 `.gitignore` 忽略，不会进提交。确认 `git status --short apps/docs` 不含 dist/cache。

---

## Task 2: 内容接入 — symlink + 裁剪 + 死链白名单

让门户渲染仓库真实 `docs/`，只发布外部页，构建保持绿。

**Files:**

- Create: `apps/docs/content` (symlink)
- Modify: `apps/docs/.vitepress/config.ts`

- [ ] **Step 1: 建相对 symlink 指向真源**

Run:

```bash
cd /Users/fooevr/Code/argus/apps/docs
ln -s ../../docs content
ls -l content
```

Expected: `content -> ../../docs`。验证它解析到真源：`test -f content/integration/sending-traces.md && echo OK`。

- [ ] **Step 2: 更新 config 加裁剪与死链白名单**

把 `apps/docs/.vitepress/config.ts` 整个替换为：

```ts
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Argus',
  description: 'Observability for AI agents',

  // Source files live under content/ (a symlink to the repo's docs/), so the
  // real markdown sits inside the VitePress root and module resolution works.
  // Exclude everything internal; publish only the customer-facing pages.
  srcExclude: [
    'content/superpowers/**',
    'content/adr/**',
    'content/architecture/**',
    'content/design/**',
    'content/api/**',
    'content/**/README.md',
    'content/conventions/coding-style.md',
    'content/conventions/git-workflow.md',
  ],

  // The published guide links to two targets that don't exist inside the
  // portal (they're valid in-repo): the example payload outside docs/, and
  // the excluded api/README. Allow exactly those; all other links stay checked.
  ignoreDeadLinks: [/example-trace\.json$/, /\/api\/README$/],
})
```

- [ ] **Step 3: 构建，确认绿且只发布外部页**

Run: `pnpm --filter @argus/docs build`
Expected: 构建成功（无 dead-link 失败）。

验证发布集：

```bash
cd /Users/fooevr/Code/argus
find apps/docs/.vitepress/dist -name '*.html' | sed 's#apps/docs/.vitepress/dist/##' | sort
```

Expected: 含 `index.html`、`content/integration/sending-traces.html`、`content/conventions/semantic-conventions.html`；**不含**任何 `superpowers`/`adr`/`architecture`/`design`/`api`/`README` 路径。

- [ ] **Step 4: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/docs/content apps/docs/.vitepress/config.ts
git commit -m "feat(docs): render repo docs via content symlink, exclude internal pages"
```

> 注：`git add apps/docs/content` 会把 symlink 本身（一个指向 `../../docs` 的链接对象）入库，不是复制目录内容。提交后用 `git show HEAD:apps/docs/content` 应输出 `../../docs`。

---

## Task 3: Console 主题 — 令牌移植 + CSS 重皮 + Layout wrapper

把 VitePress 默认主题重皮成 Unifi Console 观感。

**Files:**

- Create: `apps/docs/.vitepress/theme/tokens.css`
- Create: `apps/docs/.vitepress/theme/console.css`
- Create: `apps/docs/.vitepress/theme/Layout.vue`
- Create: `apps/docs/.vitepress/theme/index.ts`

- [ ] **Step 1: 移植 Unifi 令牌**

Create `apps/docs/.vitepress/theme/tokens.css` (值逐一对齐自 `apps/web/src/index.css`；门户只需配色相关令牌，省略 web 专用的 `--shadow-*`)：

```css
/* UniFi-authentic design tokens. Source of truth: apps/web/src/index.css.
 * Keep in sync if those values change. See docs/design/DESIGN.md. */
:root {
  --page: #ffffff;
  --surface: #ffffff;
  --inset: hsl(214 8% 98%);
  --tile: hsl(214 8% 96%);
  --hairline: hsla(214 8% 14% / 0.07);
  --hairline-strong: hsla(214 8% 14% / 0.12);

  --text-1: hsl(214 8% 14%);
  --text-2: hsl(214 8% 34%);
  --text-3: hsl(214 8% 54%);
  --text-4: hsl(214 8% 78%);

  --brand: hsl(214 100% 50%);
  --brand-hover: hsl(214 100% 60%);
  --brand-active: hsl(214 100% 40%);

  --success: hsl(138 59% 51%);
  --warning: hsl(37 91% 55%);
  --danger: hsl(358 80% 66%);

  --tint-brand: hsl(214 100% 95%);
}

.dark {
  --page: hsl(214 8% 8%);
  --surface: hsl(214 8% 8%);
  --inset: hsl(214 8% 17%);
  --tile: hsl(214 8% 17%);
  --hairline: hsla(214 8% 98% / 0.07);
  --hairline-strong: hsla(214 8% 98% / 0.12);

  --text-1: hsl(214 8% 96%);
  --text-2: hsl(214 8% 88%);
  --text-3: hsl(214 8% 60%);
  --text-4: hsl(214 8% 40%);

  --brand: hsl(214 100% 64%);
  --brand-hover: hsl(214 100% 72%);
  --brand-active: hsl(214 100% 56%);

  --tint-brand: hsl(213 88% 16%);
}
```

- [ ] **Step 2: 映射 VitePress 变量到令牌 + chrome 微调**

Create `apps/docs/.vitepress/theme/console.css`:

```css
/* Map VitePress default-theme variables onto the UniFi tokens so the whole
 * site re-skins to the Console look. Variable names per VitePress theme. */
:root {
  --vp-c-bg: var(--page);
  --vp-c-bg-alt: var(--inset);
  --vp-c-bg-soft: var(--tile);
  --vp-c-divider: var(--hairline);
  --vp-c-border: var(--hairline);
  --vp-c-gutter: var(--hairline);

  --vp-c-text-1: var(--text-1);
  --vp-c-text-2: var(--text-2);
  --vp-c-text-3: var(--text-3);

  --vp-c-brand-1: var(--brand);
  --vp-c-brand-2: var(--brand-hover);
  --vp-c-brand-3: var(--brand-active);
  --vp-c-brand-soft: var(--tint-brand);

  --vp-sidebar-bg-color: var(--sidebar, var(--page));
  --vp-nav-bg-color: var(--page);

  --vp-font-family-base: 'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif;
}

/* UniFi feel: tight radii, hairline borders, no shadows, 13px base. */
:root {
  --vp-c-default-soft: var(--tile);
}

.VPDoc,
.vp-doc {
  font-size: 13px;
  line-height: 20px;
}

/* Small radii everywhere (UniFi default 4px). */
.vp-doc div[class*='language-'],
.VPButton,
.VPSidebarItem {
  border-radius: 4px;
}

/* Cards/containers: 1px hairline, no shadow. */
.VPSidebar,
.VPNav {
  border-color: var(--hairline);
  box-shadow: none;
}
```

> 注：VitePress 变量名可能随版本细化（如品牌色用 `--vp-c-brand-1/2/3`）。本组覆盖足以重皮主色/背景/分隔线/字体；Step 5 的视觉核对若发现某处没生效，按浏览器里看到的实际变量名补一两条——但不要改 `apps/web`。

- [ ] **Step 3: 写 Layout wrapper**

Create `apps/docs/.vitepress/theme/Layout.vue` (包裹默认 Layout；当前不注入额外 slot 内容，保留为后续 chrome 注入的挂点，并确保主题结构稳定)：

```vue
<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout />
</template>
```

- [ ] **Step 4: 写 theme/index.ts**

Create `apps/docs/.vitepress/theme/index.ts`:

```ts
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import '@fontsource-variable/inter'
import './tokens.css'
import './console.css'
import Layout from './Layout.vue'

export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme
```

- [ ] **Step 5: 构建 + 本地起预览视觉核对**

Run: `pnpm --filter @argus/docs build`
Expected: 构建成功（主题/CSS 无报错）。

然后起 dev 用 preview 工具核对（见 Task 5 的浏览器步骤里统一做；此处至少确认 build 绿）。

- [ ] **Step 6: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/docs/.vitepress/theme/
git commit -m "feat(docs): Unifi Console theme via token port + VitePress var mapping"
```

---

## Task 4: 首页 + 导航

把占位首页换成策展落地页，配 sidebar/nav 指向两篇外部文档。

**Files:**

- Modify: `apps/docs/index.md`
- Modify: `apps/docs/.vitepress/config.ts`

- [ ] **Step 1: 写首页（VitePress home layout）**

把 `apps/docs/index.md` 整个替换为：

```markdown
---
layout: home
hero:
  name: Argus
  text: Observability for AI agents
  tagline: See every step of an agent session — prompts, model calls, tool calls, external resources.
  actions:
    - theme: brand
      text: Send your first trace
      link: /content/integration/sending-traces
    - theme: alt
      text: Semantic conventions
      link: /content/conventions/semantic-conventions
---
```

- [ ] **Step 2: 加 nav + sidebar 到 config**

在 `apps/docs/.vitepress/config.ts` 的 `defineConfig({ ... })` 对象里，加一个 `themeConfig`（放在 `ignoreDeadLinks` 之后、对象闭合前）：

```ts
  themeConfig: {
    siteTitle: 'Argus',
    nav: [
      { text: 'Integration', link: '/content/integration/sending-traces' },
      { text: 'Conventions', link: '/content/conventions/semantic-conventions' },
    ],
    sidebar: [
      {
        text: 'Get started',
        items: [{ text: 'Sending traces', link: '/content/integration/sending-traces' }],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Semantic conventions', link: '/content/conventions/semantic-conventions' },
        ],
      },
    ],
    search: { provider: 'local' },
  },
```

- [ ] **Step 3: 构建 + 验证链接目标存在**

Run: `pnpm --filter @argus/docs build`
Expected: 构建成功。验证两个目标页都产出了：

```bash
cd /Users/fooevr/Code/argus
test -f apps/docs/.vitepress/dist/content/integration/sending-traces.html && \
test -f apps/docs/.vitepress/dist/content/conventions/semantic-conventions.html && echo OK
```

Expected: `OK`。

- [ ] **Step 4: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/docs/index.md apps/docs/.vitepress/config.ts
git commit -m "feat(docs): curated home page + nav/sidebar/local search"
```

---

## Task 5: CI 构建 job + 全量验证

加一个保证门户能构建的 CI job，并做浏览器视觉核对 + 回归。

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 追加 docs-build job**

打开 `.github/workflows/ci.yml`，在文件**最末尾**追加下面内容（与现有 `ci` / `docs-links` 同为 `jobs:` 的子键，行首两个空格）。下方已带正确缩进，原样复制、先空一行：

```text
  docs-build:
    name: docs · portal build
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

      - name: Build docs portal
        run: pnpm --filter @argus/docs build
```

不要改动现有 `ci` / `docs-links` job、`on:`、`concurrency:`。

- [ ] **Step 2: 校验 workflow 有三个 job**

Run:

```bash
cd /Users/fooevr/Code/argus
python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); print('jobs:', list(d['jobs'].keys()))"
```

Expected: `jobs: ['ci', 'docs-links', 'docs-build']`

- [ ] **Step 3: 浏览器视觉核对（preview 工具）**

用 preview 工具起 `apps/docs` 的 dev server（launch 配置 name 用 `argus-docs`，命令 `pnpm --filter @argus/docs dev`，VitePress 默认端口 5173；若与 web 冲突，VitePress 会自动换端口，从 preview_start 返回里取实际端口）。核对：

1. 首页是 Console 风格（Inter 字体、品牌蓝 `#006FFF` 按钮、hairline 边框、浅色背景）。
2. 点 "Send your first trace" → 接入指南正确渲染，代码块高亮正常。
3. 左侧 sidebar 显示 Get started / Reference 两组；"Argus" 字标在顶部。
4. 切暗色 → 背景转为 `hsl(214 8% 8%)` 深色、文本反相，与 Console 暗色一致。
5. 搜索框输入 "token" 或 "OTLP" 能命中接入指南正文。
6. 直接访问 `/content/superpowers/...` 或 `/content/adr/...` → 404（内部内容未发布）。
7. preview_console_logs 无报错。
   截图留证（preview_screenshot，浅色 + 暗色各一张）。

- [ ] **Step 4: 回归 — 既有检查不受影响**

Run:

```bash
cd /Users/fooevr/Code/argus
pnpm test && pnpm typecheck && pnpm lint
```

Expected: 全绿。新工作区 `@argus/docs` 无 test/typecheck/lint 脚本，turbo 对缺失任务直接跳过，不影响其它包。

确认根 build 也带上门户：

```bash
pnpm build
```

Expected: 成功；turbo 运行各包 build，含 `@argus/docs#build`（其产物在 `.vitepress/dist`，未声明为 turbo `outputs` 故不缓存——可接受）。

- [ ] **Step 5: 最终状态 + 提交**

```bash
cd /Users/fooevr/Code/argus
git add .github/workflows/ci.yml
git commit -m "ci: build docs portal in CI"
git status --short
git --no-pager log --oneline -6
```

Expected: working tree 仅余既有噪声（`.idea/`、`apps/server/seed-tmp.ts`、`apps/web/.tanstack/`、`apps/web/src/routeTree.gen.ts`）；最近提交对应 Task 1–5。

---

## Self-Review

**Spec 覆盖：**

- 工作区 + VitePress + 本地跑/构建 → Task 1 ✓
- symlink 接入真源 + srcExclude 裁剪 + ignoreDeadLinks 白名单（经实测的机制）→ Task 2 ✓
- Console 主题（令牌移植 + `--vp-c-*` 映射 + Layout wrapper + Inter）→ Task 3 ✓
- 首页 + nav/sidebar + 本地搜索 → Task 4 ✓
- CI `docs-build` job + 暗色/搜索/404 视觉核对 + 回归 → Task 5 ✓
- 非目标（部署、specs/adr 纳入、OpenAPI、抽共享包、i18n）→ 计划未触及 ✓
- 验收标准（dev/build、外部页渲染、内部页 404、暗色、搜索、CI 绿、回归绿、视觉核对）→ Task 2 Step 3 / Task 5 Step 3–4 ✓

**占位符扫描：** 无 TBD/TODO；每个建文件步骤给完整内容，每个命令给期望输出。Task 3 Step 2 的"按实际变量名补一两条"是视觉核对的有界兜底，非占位（主映射已写全）。✓

**类型/标识一致性：** 包名 `@argus/docs` 全程一致；symlink 路径 `apps/docs/content → ../../docs` 与 srcExclude 的 `content/` 前缀、首页/nav/sidebar 的 `/content/...` 链接前缀一致；config 字段（`srcExclude`/`ignoreDeadLinks`/`themeConfig.search`）与 Task 4 增量不冲突（Task 4 在同一对象加 `themeConfig`）；theme `index.ts` import 的 `tokens.css`/`console.css`/`Layout.vue` 均在 Task 3 创建。✓

```

```
