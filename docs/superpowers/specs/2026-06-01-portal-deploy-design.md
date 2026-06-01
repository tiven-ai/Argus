# 门户部署到 GitHub Pages 设计

> 日期：2026-06-01
> 状态：已批准方案，待写实现计划
> 范围：新增 `.github/workflows/deploy.yml` + `apps/docs` 条件 base + 启用说明文档。不改门户内容/i18n/主题，不动 `ci.yml`。
> 关联：门户 spec（`2026-06-01-docs-portal-design.md`）把"实际托管/部署"列为后续；本项兑现之。

## 背景与目标

三语 VitePress 门户已完成但仅本地可跑 / CI 可构建。目标：发布到 GitHub Pages（`https://tiven-ai.github.io/Argus/`）。交付一个可一键启用的 deploy workflow + 子路径所需的条件 base 配置 + 给用户的"启用 Pages"操作说明。

## 数据现状（前提，经代码勘察）

- 仓库远端 `https://github.com/tiven-ai/Argus.git` → Pages 项目站点 URL 为 `https://tiven-ai.github.io/Argus/`，**子路径** `/Argus/`（非用户/组织根站点）。
- `apps/docs/.vitepress/config.ts` 当前未设 `base`（默认 `/`）。VitePress 文档明确：部署到 `user.github.io/repo/` 须设 `base: '/repo/'`（首尾带斜杠）。
- 现有 `.github/workflows/ci.yml` 有 4 job（ci / docs-links / docs-build / openapi-drift），其中 `docs-build` 跑 `pnpm --filter @argus/docs build` 作可构建保障。
- VitePress 官方 GitHub Pages 工作流用 `actions/configure-pages` + `actions/upload-pages-artifact@v3`（path 指向 dist）+ `actions/deploy-pages@v4`，需 `pages: write` / `id-token: write` 权限与 `concurrency: { group: pages, cancel-in-progress: false }`。
- 门户 build 产物在 `apps/docs/.vitepress/dist`。

## 条件 base

`apps/docs/.vitepress/config.ts` 顶层加：

```ts
base: process.env.GITHUB_ACTIONS ? '/Argus/' : '/',
```

理由：

- 本地 `dev` / `build` / `preview` → `GITHUB_ACTIONS` 未设 → `/`，本地预览资源路径正确。
- GitHub Actions 环境（含 deploy.yml 与 ci.yml 的 docs-build）→ `GITHUB_ACTIONS=true` → `/Argus/`，部署产物资源前缀正确。
- `docs-build`（CI 漂移/可构建保障）此时会以 `/Argus/` base 构建——它只验"能否成功 build"、从不服务页面，故 base 取值无害。
- 经实测确认（写实现计划阶段）：`GITHUB_ACTIONS=true pnpm --filter @argus/docs build` 的产物 HTML 资源前缀为 `/Argus/`；不带该变量时为 `/`。

> 不引入新的自定义 env var（如 `DOCS_BASE`），直接复用 Actions 内置的 `GITHUB_ACTIONS`——零额外约定、CI/本地天然区分。

## 独立 `deploy.yml`

新建 `.github/workflows/deploy.yml`（照 VitePress 官方 Pages 工作流，适配本仓 pnpm/Node20/monorepo）：

- **触发**：`push: { branches: [main] }` + `workflow_dispatch`（手动）。
- **权限**：`contents: read`、`pages: write`、`id-token: write`。
- **concurrency**：`group: pages`、`cancel-in-progress: false`（允许进行中的生产部署跑完）。
- **build job**：
  - `actions/checkout@v4`
  - `pnpm/action-setup@v4`（version 10）
  - `actions/setup-node@v4`（node-version 20、cache pnpm）
  - `actions/configure-pages@v5`
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter @argus/docs build`
  - `actions/upload-pages-artifact@v3`，`path: apps/docs/.vitepress/dist`
- **deploy job**：`needs: build`、`environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`、`actions/deploy-pages@v4`。

现有 `ci.yml` 不动。

## 启用说明（交付给用户）

在 README 或 docs 加一小节"Deploying the docs portal"，写明：

1. 在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
2. 之后每次 push 到 `main`（或手动 **Actions → Deploy VitePress site → Run workflow**）即部署。
3. 站点地址：`https://tiven-ai.github.io/Argus/`。

## 我能做 / 不能做（诚实边界）

- **能做**：编写 deploy.yml + 条件 base、本地验证构建产物 base 正确、校验 YAML 合法、merge+push。
- **不能做**：从此环境启用仓库 Pages 设置（需 GitHub UI 操作），也无法访问线上 URL 验证渲染。这两步由用户在 GitHub 侧完成，本 spec 的"启用说明"提供确切步骤。

## 测试 / 验收

- `deploy.yml` 合法 YAML；解析出 jobs = `build` + `deploy`；权限含 `pages: write` + `id-token: write`；artifact path = `apps/docs/.vitepress/dist`；触发含 push main + workflow_dispatch。
- 条件 base：`GITHUB_ACTIONS=true pnpm --filter @argus/docs build` 后产物 HTML 的 asset 引用以 `/Argus/` 开头；裸 `pnpm --filter @argus/docs build` 以 `/` 开头。
- 内部链接在 `/Argus/` base 下仍正确（VitePress 自动给相对链接加 base 前缀——实测产物里 nav/sidebar 链接带 `/Argus/`）。
- 既有 `ci.yml` 四 job 不受影响；本地 `pnpm test/typecheck/lint/build` 全绿。
- README 含启用说明。

## 组件改动清单

| 文件                             | 改动                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `.github/workflows/deploy.yml`   | 新增。GitHub Pages 部署工作流（build + deploy job）。     |
| `apps/docs/.vitepress/config.ts` | 改。加条件 `base`（`GITHUB_ACTIONS ? '/Argus/' : '/'`）。 |
| `README.md`                      | 改。加"Deploying the docs portal"小节（启用步骤 + URL）。 |

不改门户内容、i18n、主题、`ci.yml`、web/server。

## 非目标（留作后续）

- 不从此环境启用仓库 Pages 设置（用户在 GitHub Settings 操作；spec 给步骤）。
- 不配自定义域名（用默认 `tiven-ai.github.io/Argus/`）。
- 不在 deploy.yml 里跑测试（`ci.yml` 已覆盖；deploy 只构建+发布门户）。
- 不删/改 `ci.yml` 的 `docs-build`（PR 上的可构建保障；deploy 仅 push main 时触发）。
- 不做线上 URL 的自动化烟测（无法从此环境访问；用户启用后自行核对）。
