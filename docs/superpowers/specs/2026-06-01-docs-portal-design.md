# 文档门户设计（VitePress + Unifi Console 主题）

> 日期：2026-06-01
> 状态：已批准方案，待写实现计划
> 范围：新增 `apps/docs/` 工作区 + 一个 CI 构建 job。不改产品代码、不改 `docs/` 既有内容。
> 关联：兑现 [ADR-0005](../../adr/0005-docs-as-code-portal.md)（docs-as-code，门户是生成的视图层）；内容组织遵循 [`docs/README.md`](../../README.md)。

## 背景与目标

ADR-0005 决定：文档源是仓库 `docs/` 下的 Markdown，门户是渲染它们的视图层。本项把这个门户落地：一个能本地跑、能在 CI 构建的静态站，**直接渲染** `docs/` 的真实 markdown（不复制内容，保持单一真源），且**视觉上复刻 Argus 产品的 Unifi Console 外观**。

成功标准：`pnpm --filter @argus/docs dev` 起本地预览；`pnpm --filter @argus/docs build` 产出静态站；外部面向的文档（接入指南、语义约定）可浏览、可搜索、有暗色模式，外壳是 Console 风格（同一套 Unifi 令牌）。

## 数据现状（前提）

- 仓库 pnpm 10 / Node ≥20，`pnpm-workspace.yaml` 含 `apps/*`；现有 `apps/server`、`apps/web`。web 端用 Vite 6 + React 19 + Tailwind 4。
- Unifi 设计令牌是**纯 CSS 自定义属性**，定义在 [`apps/web/src/index.css`](../../../apps/web/src/index.css) 的 `:root`（light）与 `.dark`（dark）块，并通过 `@theme inline` 暴露给 Tailwind。关键值：
  - 颜色：`--page #fff`、`--tile hsl(214 8% 96%)`、`--hairline hsla(214 8% 14% / 0.07)`、`--text-1/2/3/4`、`--brand hsl(214 100% 50%)`、各 `--tint-*`；`.dark` 有整套对应值。
  - 圆角：`--radius 4px`、`--radius-md 8px`。
  - 字体：`Inter Variable`（`@fontsource-variable/inter`，web 端在 `main.tsx` import），基准 `13px/20px`，标题 `15px`，caption `11px`。
  - 质感铁律（DESIGN.md）：卡片透明、**无阴影**、1px hairline 边框、紧凑间距。
- `docs/` 有 46 个 md，含大量**内部**内容：`superpowers/specs` + `superpowers/plans`（brainstorm/计划迹）、`adr/`、`architecture/`、`design/`、各文件夹 `README.md`、`conventions/coding-style.md`、`conventions/git-workflow.md`。
- 外部面向、适合发布的：`integration/sending-traces.md`、`conventions/semantic-conventions.md`。`docs/api/` 目前只有一个占位 README（OpenAPI 尚未生成），本期不纳入。
- 现有 CI `.github/workflows/ci.yml` 有 `ci` 与 `docs-links` 两个 job。

## 架构

新建 `apps/docs/` 工作区，包 `@argus/docs`，用 VitePress。

```
apps/docs/
  package.json                 # @argus/docs；dev/build/preview 脚本；deps: vitepress, vue, @fontsource-variable/inter
  content -> ../../docs        # symlink 指向仓库真源 docs/（入库；产物/缓存被 gitignore）
  index.md                     # 策展的门户首页（在 apps/docs/，VitePress root）
  .gitignore                   # 忽略 .vitepress/dist、.vitepress/cache
  .vitepress/
    config.ts                  # srcExclude=全部内部内容；ignoreDeadLinks 白名单；nav/sidebar；本地搜索
    theme/
      index.ts                 # extends DefaultTheme，Layout 用 wrapper，import CSS + 字体
      Layout.vue               # 包裹 DefaultTheme.Layout（slots 注入"Argus"字标等 chrome）
      tokens.css               # 移植自 apps/web/src/index.css 的 Unifi 令牌（:root + .dark）
      console.css              # 把 VitePress --vp-c-* 变量映射到 Unifi 令牌 + chrome 微调
```

### 内容来源与裁剪（单一真源）

> **机制更正（经实测）：** VitePress 的 `srcDir` 指向项目根**之外**（`../../docs`）在本仓库的严格 pnpm（`shamefully-hoist=false`）下**构建失败**——`docs/` 下的 md 落在 VitePress root（`apps/docs`）之外，无法解析 `vue/server-renderer`。改用**符号链接**：在 `apps/docs/content` 建一个指向仓库 `docs/` 的相对 symlink（`ln -s ../../docs content`），VitePress root 仍是 `apps/docs`、`srcDir` 用默认（`.`）。这样真实 md 在 root 之内、模块解析正常，且 git 里**不存在副本**（symlink 本身入库，指向真源），仍满足单一真源。`content/` 编译产物与缓存在 `.gitignore` 里忽略。

- 门户**通过 `content/` symlink 读真实 md**，不复制内容。
- `srcExclude` 排除所有内部内容（glob，路径相对 srcDir，即含 `content/` 前缀）：`content/superpowers/**`、`content/adr/**`、`content/architecture/**`、`content/design/**`、`content/api/**`、`content/**/README.md`、`content/conventions/coding-style.md`、`content/conventions/git-workflow.md`。
- 结果发布的页面：`content/integration/sending-traces.md`、`content/conventions/semantic-conventions.md`，加上门户自己的 `index.md` 首页。
- **死链处理（经实测）：** VitePress build 默认对死链失败。已发布的 `sending-traces.md` 链接到两个在门户里不存在的目标：`../../scripts/example-trace.json`（docs 树之外）与 `../api/README.md`（被 srcExclude）。用 `ignoreDeadLinks` **定向白名单**（仅这两类，不全局关闭死链检查）放行：`ignoreDeadLinks: [/example-trace\.json$/, /\/api\/README$/]`。其余真实页面的链接仍受检。
- 门户首页 `index.md` 放在 `apps/docs/`（VitePress root，不污染仓库 `docs/`），用 VitePress home layout 做一个简短落地页（标题 + 指向"接入指南""语义约定"的入口）。

### Console chrome 复刻（自定义主题）

`theme/index.ts` 用 `extends: DefaultTheme` + `Layout: Layout.vue`，其中 `Layout.vue` **包裹** `DefaultTheme.Layout`（通过其 slots 注入 chrome，而非从零重建侧栏/顶栏——这是 VitePress 官方推荐的扩展方式，风险低且保留默认主题的导航/搜索/大纲结构）。Console 观感主要靠 CSS（把 `--vp-c-*` 映射到 Unifi 令牌）达成，而非重写组件树。正文仍由 VitePress 渲染（保留代码高亮、锚点等）。

- **令牌**：`tokens.css` 原样移植 `apps/web/src/index.css` 的 `:root` 与 `.dark` 变量块（值逐一对齐）。顶部注释标明 `源：apps/web/src/index.css，改动需同步`（令牌是测量常量、极少变；抽共享包留作后续，见非目标）。
- **映射**：`console.css` 把 VitePress 主题变量映射到 Unifi 令牌——`--vp-c-brand-1: var(--brand)`、`--vp-c-bg: var(--page)`、`--vp-c-divider: var(--hairline)`、`--vp-c-text-1/2/3` 对应 `--text-1/2/3`、字体 `--vp-font-family-base: 'Inter Variable', …`、基准字号 13px。暗色模式：VitePress 用 `.dark` class 切换，与我们 `.dark` 令牌天然对齐。
- **Layout.vue（Console 外壳）**：
  - **sidebar**（VitePress 自带，CSS 重皮）：通过 `themeConfig.logo` / `siteTitle` 显示 "Argus" 字标；文档导航（"接入指南""语义约定"）来自 `themeConfig.sidebar`；用 hairline 分隔、tile 选中态、4px 圆角复刻 Console 观感。
  - **顶栏**（VitePress nav，CSS 重皮）：标题 + 搜索入口 + 暗色切换。
  - **内容面板**：VitePress 默认正文容器；排版套 Unifi 字阶（13/20 正文、15 标题、11 caption）。
  - 卡片/容器：透明背景、无阴影、1px hairline——遵守 DESIGN.md 五铁律。
  - 这是用 **CSS 在主题层视觉复刻** + slot 注入少量 chrome，非复用 apps/web 的 React 组件（跨框架不可复用）；目标是"同一套设计语言/令牌"，不是同一棵组件树。
- **字体**：门户 `package.json` 依赖 `@fontsource-variable/inter`，在 `theme/index.ts` import（与 web 端同款）。

### 内置能力（VitePress 自带，零额外维护）

- 本地搜索（`themeConfig.search.provider = 'local'`，minisearch）。
- 代码高亮（Shiki）。
- 暗色模式（class 切换，对齐 `.dark` 令牌）。
- 响应式布局。

## CI

`.github/workflows/ci.yml` 增加一个与现有 job 并行的 `docs-build`：checkout → pnpm/action-setup → setup-node(20, cache pnpm) → `pnpm install --frozen-lockfile` → `pnpm --filter @argus/docs build`。保证门户始终能构建。现有 `ci`、`docs-links` 不动。

> 注：根 `pnpm build` 走 turbo，会把 `apps/docs` 的 build 纳入（如果 docs 有 `build` 任务且 turbo 默认拾取）。实现计划需确认 turbo 是否会自动跑 docs build；若会，根 `pnpm build` 同时覆盖，`docs-build` job 作为显式保障仍保留。

## 测试 / 验收

- `pnpm --filter @argus/docs dev` 起预览，浏览器可见 Console 风格外壳 + 首页。
- 导航到"接入指南"与"语义约定"，内容正确渲染（来自仓库真实 md，非副本）。
- 内部内容（如 specs/plans/adr）**不出现**在站内（被 srcExclude）。
- 暗色切换工作，色板与 Console 暗色一致。
- 本地搜索能命中正文。
- `pnpm --filter @argus/docs build` 成功产出静态站；CI `docs-build` job 绿。
- 既有 `pnpm test` / `typecheck` / `lint` / `docs-links` 不受影响。
- 视觉核对（preview 工具截图）：侧边栏字标、hairline 边框、4px 圆角、Inter 13px 基准、品牌蓝链接——与 apps/web 观感一致。

## 非目标（留作后续，可能各需一个决定/ADR）

- 实际托管 / 部署（gh-pages / Vercel / Netlify）——本期只到"本地能跑 + CI 能构建"。
- 把 `superpowers/specs`、`plans`、`adr`、`architecture` 纳入发布。
- OpenAPI 从 Zod 生成并纳入 api 页。
- 把 Unifi 令牌抽成 web 与 docs 共享的 CSS 包（先复制 + 注释）。
- 多语言（i18n）门户。
- 严格"同一 React 组件树"的复用（跨框架不可行；本期是视觉复刻）。

## 组件改动清单

| 文件                                     | 改动                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/docs/package.json`                 | 新增。`@argus/docs`，dev/build/preview 脚本，deps: vitepress + vue + @fontsource-variable/inter。 |
| `apps/docs/content`                      | 新增。相对 symlink → `../../docs`（指向真源，无副本）。                                           |
| `apps/docs/.vitepress/config.ts`         | 新增。srcExclude、ignoreDeadLinks 白名单、nav/sidebar、本地搜索。                                 |
| `apps/docs/.vitepress/theme/index.ts`    | 新增。`extends: DefaultTheme` + Layout wrapper + import CSS + 字体。                              |
| `apps/docs/.vitepress/theme/Layout.vue`  | 新增。包裹 `DefaultTheme.Layout`，slot 注入 chrome。                                              |
| `apps/docs/.vitepress/theme/tokens.css`  | 新增。移植 Unifi 令牌（`:root` + `.dark`）。                                                      |
| `apps/docs/.vitepress/theme/console.css` | 新增。VitePress 变量 → Unifi 令牌映射 + chrome 样式。                                             |
| `apps/docs/index.md`                     | 新增。门户首页。                                                                                  |
| `apps/docs/.gitignore`                   | 新增。忽略 `.vitepress/dist` 与 `.vitepress/cache`。                                              |
| `.github/workflows/ci.yml`               | 修改。新增并行 `docs-build` job；现有 job 不动。                                                  |

不改 `apps/web`、`apps/server`、`packages/*`，不改 `docs/` 既有内容。
