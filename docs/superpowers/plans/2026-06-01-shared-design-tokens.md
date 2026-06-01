# 共享设计令牌包 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把重复在 web 与 docs 两处的 Unifi 设计令牌（`:root`/`.dark` CSS 自定义属性）抽到一个新的 `@argus/design-tokens` 包，两边改为 import 它，删除 docs 的副本——单一真源，不改任何令牌值。

**Architecture:** 新增"raw-consumed、无构建"的 CSS 包 `packages/design-tokens`（仿 `packages/tsconfig`），内含完整 `:root` + `.dark` 令牌。`apps/web/src/index.css` 删除内联令牌、改为 `@import '@argus/design-tokens/tokens.css'`（在 `@import 'tailwindcss'` 之后），保留 Tailwind 的 `@theme inline`/`@layer`/`u-*`。docs 主题改 import 同一包、删除本地 `tokens.css`。

**Tech Stack:** pnpm workspaces + Vite 6（web，`@tailwindcss/vite`）+ VitePress 1.6.4（docs）。纯 CSS 迁移，无 TS、无测试代码（验证靠 build + 浏览器核对）。

**Spec:** `docs/superpowers/specs/2026-06-01-shared-design-tokens-design.md`

**已实测确认（写计划前在真仓库验证，关键去险）：**

- 把 web 的 `:root`/`.dark`（index.css 第 9–71 行）搬进 `packages/design-tokens/tokens.css`，web index.css 改成 `@import 'tailwindcss';` + `@import '@argus/design-tokens/tokens.css';` 后 `pnpm --filter @argus/web build` **绿**；产物 CSS 含 `--brand:#006fff`（light）/`#4797ff`（dark），且 `.bg-page{background-color:var(--page)}`、`.text-brand{color:var(--brand)}` 仍正确生成——**Tailwind v4 的 @import 顺序没问题**。
- docs 把 `import './tokens.css'` 改成 `import '@argus/design-tokens/tokens.css'`、删除本地 tokens.css 后 `pnpm --filter @argus/docs build` **绿**，产物含 `--brand`。
- 这是后续四项里爆炸半径最大的（动生产 web 样式入口），但上面端到端实测已通过。

**命令约定：**

- web 构建：`pnpm --filter @argus/web build`
- docs 构建：`pnpm --filter @argus/docs build`
- 安装：仓库根 `pnpm install`
- 提交遵循 commitlint（subject 小写）。预提交钩子格式化 `*.{json,md,yml,yaml,css}`。不要 `--no-verify`。

---

## File Structure

| 文件                                    | 角色                                                                  |
| --------------------------------------- | --------------------------------------------------------------------- |
| `packages/design-tokens/package.json`   | 新增。`@argus/design-tokens`，exports `./tokens.css`，无构建。        |
| `packages/design-tokens/tokens.css`     | 新增。完整 `:root` + `.dark` 令牌（搬自 web index.css 9–71 行）。     |
| `apps/web/src/index.css`                | 改。删内联 `:root`/`.dark`，加 `@import` 共享包；保留 Tailwind 胶水。 |
| `apps/web/package.json`                 | 改。加 `@argus/design-tokens: workspace:*`。                          |
| `apps/docs/.vitepress/theme/index.ts`   | 改。import 路径指向共享包。                                           |
| `apps/docs/.vitepress/theme/tokens.css` | 删除（副本）。                                                        |
| `apps/docs/package.json`                | 改。加 `@argus/design-tokens: workspace:*`。                          |
| `pnpm-lock.yaml`                        | 更新。                                                                |

任务顺序：Task 1 建包 → Task 2 web 接入 → Task 3 docs 接入 → Task 4 全量验证 + 浏览器核对。

---

## Task 1: 新建 `@argus/design-tokens` 包

把 web 的令牌块原样搬进一个独立 CSS 包。

**Files:**

- Create: `packages/design-tokens/package.json`
- Create: `packages/design-tokens/tokens.css`

- [ ] **Step 1: 写 package.json**

Create `packages/design-tokens/package.json`:

```json
{
  "name": "@argus/design-tokens",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./tokens.css": "./tokens.css"
  },
  "files": ["tokens.css"]
}
```

- [ ] **Step 2: 写 tokens.css（从 web index.css 第 9–71 行原样搬来）**

Create `packages/design-tokens/tokens.css` with EXACTLY this content (these are the `:root` + `.dark` blocks lifted verbatim from `apps/web/src/index.css`; the header comment is updated to reflect it's now the source of truth):

```css
/* UniFi-authentic design tokens — single source of truth for both apps/web
 * (Tailwind) and apps/docs (VitePress). Values measured from the live UniFi
 * Network dashboard; see docs/design/DESIGN.md. Light = :root, dark = .dark. */
:root {
  color-scheme: light;

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
  --tint-success: hsl(138 60% 95%);
  --tint-warning: hsl(37 91% 95%);
  --tint-danger: hsl(357 82% 96%);

  --popover: #ffffff;
  --sidebar: #ffffff;

  --shadow-popover: 0 4px 12px hsla(214 8% 14% / 0.08), 0 0 1px hsla(214 8% 14% / 0.08);
  --shadow-dialog: 0 8px 24px hsla(214 8% 14% / 0.08), 0 0 1px hsla(214 8% 14% / 0.08);
  --shadow-modal: 0 12px 48px hsla(214 8% 14% / 0.12), 0 0 1px hsla(214 8% 14% / 0.08);
}

.dark {
  color-scheme: dark;

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
  --tint-success: hsl(138 40% 14%);
  --tint-warning: hsl(37 50% 16%);
  --tint-danger: hsl(357 50% 18%);

  --popover: hsl(214 8% 17%);
  --sidebar: hsl(214 8% 12%);
}
```

- [ ] **Step 3: 装包（让 workspace 注册新包）**

Run: `cd /Users/fooevr/Code/argus && pnpm install`
Expected: 成功；`packages/*` glob 纳入 `@argus/design-tokens`。

- [ ] **Step 4: 提交**

```bash
cd /Users/fooevr/Code/argus
git add packages/design-tokens/package.json packages/design-tokens/tokens.css pnpm-lock.yaml
git commit -m "feat(design-tokens): shared css package for unifi tokens"
```

---

## Task 2: web 改用共享包

删 web 的内联令牌，改为 import 共享包；保留 Tailwind 胶水。

**Files:**

- Modify: `apps/web/src/index.css`
- Modify: `apps/web/package.json`

- [ ] **Step 1: 给 web 加依赖**

在 `apps/web/package.json` 的 `"dependencies"` 里加一行（与现有 `@argus/shared-types` 同列，保持字母序/合法 JSON）：

```json
    "@argus/design-tokens": "workspace:*",
```

然后 `cd /Users/fooevr/Code/argus && pnpm install`（让 web 链接到该包）。Expected: 成功。

- [ ] **Step 2: 改 index.css**

编辑 `apps/web/src/index.css`：

1. 在第 1 行 `@import 'tailwindcss';` **之后**插入一行：
   ```css
   @import '@argus/design-tokens/tokens.css';
   ```
2. **删除**整个 `:root { ... }` 块（`color-scheme: light;` 起到该块的 `}`）与整个 `.dark { ... }` 块，以及它们之间的注释/空行——即原文件第 3–71 行那段（从 `/* UniFi-authentic design tokens. Values measured ... */` 注释到 `.dark { ... }` 结束）。
3. **保留**自 `@theme inline {` 起的全部内容（Tailwind 映射 + `@layer base` + `@layer components` 的 `u-*` 类）原样不动。

改完后 `index.css` 应以这样开头：

```css
@import 'tailwindcss';
@import '@argus/design-tokens/tokens.css';

/* Expose tokens to Tailwind v4 utilities: bg-page, border-hairline,
 * text-text-1, text-brand, bg-tint-success, rounded-md (8px), etc. */
@theme inline {
  --color-page: var(--page);
  ...
```

（即：两行 import → 空行 → `@theme inline` 注释与块 → `@layer` 块。文件中不再出现任何 `:root {` 或 `.dark {` 令牌定义。）

- [ ] **Step 3: 构建并验证令牌 + utilities 仍正确**

Run: `cd /Users/fooevr/Code/argus && pnpm --filter @argus/web build`
Expected: BUILD 成功。

验证产物 CSS 含令牌且 Tailwind utilities 解析正确：

```bash
cd /Users/fooevr/Code/argus
css=$(ls apps/web/dist/assets/*.css | head -1)
grep -o '\-\-brand:#006fff' "$css" | head -1
grep -o '\.bg-page{[^}]*}' "$css" | head -1
grep -o '\.text-brand{[^}]*}' "$css" | head -1
```

Expected:

```
--brand:#006fff
.bg-page{background-color:var(--page)}
.text-brand{color:var(--brand)}
```

（令牌来自共享包、utilities 仍生成——证明迁移无回归。）

- [ ] **Step 4: 确认 web 源里不再有令牌定义**

Run: `cd /Users/fooevr/Code/argus && grep -nE '^\s*:root \{|^\s*\.dark \{' apps/web/src/index.css`
Expected: 无输出（令牌块已移走）。

- [ ] **Step 5: typecheck + lint（确保没碰坏别的）**

Run: `cd /Users/fooevr/Code/argus && pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint`
Expected: 均 exit 0。

- [ ] **Step 6: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/web/src/index.css apps/web/package.json pnpm-lock.yaml
git commit -m "refactor(web): consume shared design-tokens package"
```

---

## Task 3: docs 改用共享包

docs 主题改 import 共享包，删除本地 tokens.css 副本。

**Files:**

- Modify: `apps/docs/.vitepress/theme/index.ts`
- Delete: `apps/docs/.vitepress/theme/tokens.css`
- Modify: `apps/docs/package.json`

- [ ] **Step 1: 给 docs 加依赖**

在 `apps/docs/package.json` 的 `"dependencies"` 里加（与现有 `@fontsource-variable/inter` 同列）：

```json
    "@argus/design-tokens": "workspace:*",
```

然后 `cd /Users/fooevr/Code/argus && pnpm install`。Expected: 成功。

- [ ] **Step 2: 改 theme/index.ts 的 import**

编辑 `apps/docs/.vitepress/theme/index.ts`，把这行：

```ts
import './tokens.css'
```

改为：

```ts
import '@argus/design-tokens/tokens.css'
```

其余 import（`@fontsource-variable/inter`、`./console.css`、`Layout.vue`）与顺序不变——令牌 import 仍在 `./console.css` 之前。

- [ ] **Step 3: 删除本地副本**

Run: `cd /Users/fooevr/Code/argus && git rm apps/docs/.vitepress/theme/tokens.css`
Expected: `rm '...tokens.css'`。

- [ ] **Step 4: 确认无残留引用**

Run: `cd /Users/fooevr/Code/argus && grep -rn "theme/tokens.css\|'./tokens.css'" apps/docs`
Expected: 无输出（没有任何地方还引用被删的本地 tokens.css）。

- [ ] **Step 5: 构建并验证令牌仍可用**

Run: `cd /Users/fooevr/Code/argus && rm -rf apps/docs/.vitepress/dist apps/docs/.vitepress/cache && pnpm --filter @argus/docs build`
Expected: BUILD 成功。

```bash
cd /Users/fooevr/Code/argus
dcss=$(ls apps/docs/.vitepress/dist/assets/style*.css | head -1)
grep -o '\-\-brand' "$dcss" | head -1
```

Expected: `--brand`（令牌经共享包进入产物）。

- [ ] **Step 6: 提交**

```bash
cd /Users/fooevr/Code/argus
git add apps/docs/.vitepress/theme/index.ts apps/docs/package.json
git commit -m "refactor(docs): consume shared design-tokens package"
```

（注：`git rm` 已 stage 了删除；本次提交含 import 改动 + 删除 + package.json。`git add` 不需要再列被删文件。确认 `git status` 中 tokens.css 为 deleted、已 staged。）

---

## Task 4: 全量验证 + 浏览器核对

确认单一真源、两端 build 绿、外观不变、回归全过。

**Files:** 无（仅命令 + 浏览器）。

- [ ] **Step 1: 单一真源核对**

Run:

```bash
cd /Users/fooevr/Code/argus
grep -rln '^\s*:root \{' apps packages --include='*.css' | grep -v node_modules
echo "---dark---"
grep -rln '^\s*\.dark \{' apps packages --include='*.css' | grep -v node_modules
```

Expected: 两个 grep 都**只**列出 `packages/design-tokens/tokens.css`（令牌定义在仓库内只剩一处）。注意 `apps/web/src/index.css` 不应再出现。

- [ ] **Step 2: 全量回归**

Run: `cd /Users/fooevr/Code/argus && pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: 全绿（4 包 build 含 web + docs；turbo 对无 test/lint 任务的 design-tokens 包跳过）。

- [ ] **Step 3: 浏览器核对 web 外观不变（preview 工具）**

启动 web dev（launch 配置 `argus-web`，端口 5173；若被占用取实际端口）。核对：

1. 页面主色仍是品牌蓝 `#006fff`（按钮/链接）；卡片 hairline 边框、浅色背景如常。
2. 进一个有内容的页面（如 sessions 列表或登录页），整体配色与迁移前一致。
3. preview_inspect 取某个 `.text-brand` / `bg-page` 元素，确认计算色值正确（brand = `rgb(0,111,255)`）。
4. preview_console_logs 无 CSS/加载报错。
   截图留证。

- [ ] **Step 4: 浏览器核对 docs 外观不变**

启动 docs dev（launch 配置 `argus-docs`，端口 5180）。核对：

1. 首页/接入指南仍是 Console 风格（品牌蓝、Inter 13px、hairline）。
2. 切暗色，色板与之前一致（`hsl(214 8% 8%)` 深色背景）。
   截图留证。

- [ ] **Step 5: 最终状态**

Run:

```bash
cd /Users/fooevr/Code/argus
git status --short
git --no-pager log --oneline -4
```

Expected: working tree 仅余既有噪声（`.idea/`、`seed-tmp.ts`、`.tanstack/`、`routeTree.gen.ts`）；最近提交对应 Task 1–3。

---

## Self-Review

**Spec 覆盖：**

- 新 raw-consumed CSS 包（全集令牌、无构建）→ Task 1 ✓
- web 接入（删内联、@import 共享包、保留 Tailwind 胶水、加依赖）→ Task 2 ✓
- docs 接入（改 import、删副本、加依赖）→ Task 3 ✓
- 单一真源验证（令牌仅一处）→ Task 4 Step 1 ✓
- 外观不变（web + docs 浏览器核对）→ Task 4 Step 3/4 ✓
- 回归全绿 → Task 4 Step 2 ✓
- 非目标（不动 @theme/u-_/--vp-c-_、不改值、不抽 TS）→ 计划未触及 ✓

**占位符扫描：** 无 TBD/TODO；每个改文件步骤给完整代码或精确编辑指令 + 期望输出。tokens.css 全量内容内联给出（不靠"搬来"指代）。✓

**类型/标识一致性：** 包名 `@argus/design-tokens` 全程一致；import 路径 `@argus/design-tokens/tokens.css` 与 package.json `exports` 键一致；web/docs 依赖均 `workspace:*`；令牌值与 spec 勘察的 web index.css 9–71 行逐字对应（已实测搬迁后 build 通过）。✓
