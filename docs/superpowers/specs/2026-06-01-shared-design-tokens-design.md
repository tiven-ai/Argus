# 共享设计令牌包设计（消除 web/docs 令牌重复）

> 日期：2026-06-01
> 状态：已批准方案，待写实现计划
> 范围：新增 `packages/design-tokens`（仅 CSS，无构建）；web 与 docs 改为 import 它；删除 docs 的令牌副本。不改任何令牌值。
> 关联：偿还 `apps/docs/.vitepress/theme/tokens.css` 顶部"keep in sync"注释代表的复制债（ADR-0005 与门户 spec 当初将"抽共享包"列为后续）。

## 背景与目标

Unifi 设计令牌（CSS 自定义属性）目前**重复两处**：

- `apps/web/src/index.css` 第 9–71 行的 `:root`（light）+ `.dark` 块——真源，含全套 24 个令牌（颜色/文本/品牌/tint/popover/sidebar/shadow）。
- `apps/docs/.vitepress/theme/tokens.css`——手抄的**子集**（仅 color/text/brand/tint-brand），顶部写着"Source of truth: apps/web/src/index.css. Keep in sync"。

目标：把 `:root`/`.dark` 原始令牌抽到一个共享包，web 与 docs 都从它 import，删掉 docs 的副本与同步注释。各消费方保留自己的框架胶水（web 的 Tailwind `@theme`/`@layer`/`u-*`；docs 的 `--vp-c-*` 映射）。

## 数据现状（前提，经代码勘察）

- **可移植部分**：`apps/web/src/index.css` 第 9–71 行（纯 `:root` + `.dark` 自定义属性）——与框架无关。
- **web 专属**（必须留在 app）：`@import 'tailwindcss'`（行 1）、`@theme inline`（73–110，把令牌映射成 Tailwind utilities 如 `bg-page`）、`@layer base`（112–127）、`@layer components` 的 `u-*` 字阶类（129–169）。这些引用 `var(--token)`，令牌移走后仍能解析。
- **docs 专属**（必须留在 docs）：`apps/docs/.vitepress/theme/console.css` 的 `--vp-c-*` → `var(--token)` 映射。
- **消费方均为 Vite 系**：web 用 Vite 6 + `@tailwindcss/vite`；docs 用 VitePress 1.6.4（内含 Vite）。两者都能 import 工作区包的 CSS。
- **包约定**：`packages/tsconfig` 是"raw-consumed、无构建、无 JS"包的先例（package.json 仅 `name`/`private`/`files`）。`@argus/*` 命名，apps 用 `workspace:*` 依赖。
- **无测试/CI 触及这些 CSS**：唯一引用是 `apps/web/src/main.tsx` 的 `import './index.css'` 与 docs 主题的 import；纯副作用样式，无断言。
- ⚠️ Tailwind v4 的 `@import` 顺序敏感：`@import 'tailwindcss'` 之后再 `@import` 令牌包，需实测验证 `@theme inline` 仍能引用到令牌、utilities 仍生成。

## 新包 `@argus/design-tokens`（消费式，不构建）

仿 `packages/tsconfig`：

- `packages/design-tokens/package.json`：
  ```jsonc
  {
    "name": "@argus/design-tokens",
    "version": "0.0.0",
    "private": true,
    "exports": { "./tokens.css": "./tokens.css" },
    "files": ["tokens.css"],
  }
  ```
- `packages/design-tokens/tokens.css`：**完整** `:root` + `.dark` 块（24 个令牌全套，从 `apps/web/src/index.css` 第 9–71 行原样搬来，含 `color-scheme` 与 shadow/popover/sidebar/tint-\*）。
  - **全集而非子集**：包里放全部令牌。未被某消费方用到的变量零成本，且**彻底根除"docs 子集会漂移"**——这正是本项要消灭的问题。

## 消费方改动

### web（`apps/web`）

- `apps/web/src/index.css`：把第 9–71 行的 `:root`/`.dark` 块**删除**，在 `@import 'tailwindcss'` 之后加 `@import '@argus/design-tokens/tokens.css';`。保留 `@theme inline` / `@layer base` / `@layer components` 原样（仍 `var(--token)`）。
- `apps/web/package.json`：`dependencies` 加 `"@argus/design-tokens": "workspace:*"`。

### docs（`apps/docs`）

- 删除 `apps/docs/.vitepress/theme/tokens.css`。
- `apps/docs/.vitepress/theme/index.ts`：`import './tokens.css'` → `import '@argus/design-tokens/tokens.css'`（保持在 `console.css` 之前的顺序）。
- `console.css` 不动。
- `apps/docs/package.json`：`dependencies` 加 `"@argus/design-tokens": "workspace:*"`。

> 注：docs 原来只抄了子集；改用全集包后 docs 会拿到全部令牌（含它过去省略的 shadow/popover/tint-\*）——无害（`console.css` 只引用其中一部分），且消除了子集维护负担。

## 关键风险与缓解

这是后续四项里**爆炸半径最大**的——动的是生产 web 应用的样式入口。若 Tailwind v4 `@import` 顺序处理不当，web UI 配色可能整体失效。

**缓解（写实现计划前先实测，沿用本会话一贯做法）：** 在真仓库里验证 web `pnpm build` 后：(a) 产物 CSS 里 `--brand` 等令牌仍存在；(b) `@theme` 生成的 utility（如 `bg-page` / `text-brand`）仍解析到正确色值。docs 同样验证 build 通过、令牌可用。任一不过 → 停下、报告、不硬上（可能需调整 `@import` 位置或回退到"包内同时含 `@theme`"等方案）。

## 测试 / 验收

- `grep` 确认 `:root {` / `.dark {` 令牌块在仓库内**只剩一处**（`packages/design-tokens/tokens.css`）；`apps/web/src/index.css` 与 `apps/docs/.vitepress/theme/` 不再含令牌定义。
- web：`pnpm --filter @argus/web build` 绿；浏览器核对页面配色不变（品牌蓝 `#006fff`、hairline、暗色）——preview 截图比对。
- docs：`pnpm --filter @argus/docs build` 绿；门户外观不变（preview 截图比对，含暗色）。
- 全量：`pnpm test` / `typecheck` / `lint` / `build` 全绿；既有 CI 四 job + openapi-drift 不受影响（令牌不入 openapi）。
- docs-links / docs-build CI 仍绿。

## 组件改动清单

| 文件                                    | 改动                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `packages/design-tokens/package.json`   | 新增。`@argus/design-tokens`，exports `./tokens.css`。                  |
| `packages/design-tokens/tokens.css`     | 新增。完整 `:root` + `.dark` 令牌（搬自 web）。                         |
| `apps/web/src/index.css`                | 改。删本地 `:root`/`.dark`，改为 `@import` 共享包；保留 Tailwind 胶水。 |
| `apps/web/package.json`                 | 改。加 `@argus/design-tokens` 依赖。                                    |
| `apps/docs/.vitepress/theme/index.ts`   | 改。import 路径指向共享包。                                             |
| `apps/docs/.vitepress/theme/tokens.css` | 删除（副本）。                                                          |
| `apps/docs/package.json`                | 改。加 `@argus/design-tokens` 依赖。                                    |
| `pnpm-lock.yaml`                        | 更新（新工作区包）。                                                    |

## 非目标（留作后续）

- 不动 `@theme inline`、`u-*` 工具类（web 专属）、`--vp-c-*` 映射（docs 专属）。
- 不抽 JS/TS 令牌（如导出 TS 常量），不加构建步骤。
- 不改任何令牌值（纯搬迁）。
- 不引入令牌-漂移 CI（搬迁后只剩一处定义，天然无漂移可言）。
