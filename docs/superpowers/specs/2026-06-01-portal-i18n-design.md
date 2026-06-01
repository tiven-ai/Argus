# 门户 i18n 设计（en / zh-CN / ja）

> 日期：2026-06-01
> 状态：已批准方案，待写实现计划
> 范围：仅 `apps/docs`——加 VitePress `locales` + 中日译文（门户层资产）。不改 `docs/`、不改 web/server。
> 关联：ADR-0005「英文单源 + 门户层翻译」；门户 spec `2026-06-01-docs-portal-design.md` 把 i18n 列为后续。

## 背景与目标

VitePress 门户当前仅英文。目标：三语化（en / zh-CN / ja），**英文保持唯一真源**（经 `apps/docs/content` symlink 读仓库 `docs/`），中日译文作为门户层资产放在 `apps/docs/zh/`、`apps/docs/ja/`，**不进 `docs/`**（不污染主题中立的英文源树）。

## 数据现状（前提，经代码勘察）

- 门户在 `apps/docs`，VitePress 1.6.4。`apps/docs/content` 是指向 `../../docs` 的 symlink；`vite.resolve.preserveSymlinks: true`。
- 英文发布集：`content/integration/sending-traces.md`、`content/conventions/semantic-conventions.md`，加门户首页 `apps/docs/index.md`（home hero）。其余 `content/**` 被 `srcExclude` 裁掉。
- 自定义主题（`.vitepress/theme/`）：`extends DefaultTheme` + Layout wrapper + 移植的 Unifi 令牌（现来自 `@argus/design-tokens`）+ `console.css` 的 `--vp-c-*` 映射。本地搜索 `provider: 'local'`。
- `config.ts` 已有顶层 `themeConfig`（nav/sidebar/search）、`srcExclude`、`ignoreDeadLinks`、`vite`。
- VitePress i18n（官方文档确认）：`locales` 对象，key=`root` 为默认语言；非 root 的 key（如 `zh`）映射到同名顶层目录 `apps/docs/zh/` 与路由前缀 `/zh/`；每 locale 可有自己的 `lang`/`label`/`link`/`themeConfig`（themeConfig 浅合并到顶层）。顶栏自动出现语言切换菜单，跳转用各 locale 的 `link`。

## 结构（VitePress `locales`）

`config.ts` 顶层加：

```ts
locales: {
  root: { label: 'English', lang: 'en' },
  zh: { label: '简体中文', lang: 'zh-CN', link: '/zh/' },
  ja: { label: '日本語', lang: 'ja', link: '/ja/' },
},
```

- **root（en）**：现状不变——`content/` 读英文真源；nav/sidebar 指向 `/content/...`。把现有顶层 `themeConfig` 的 nav/sidebar 留作 root（或移入 `locales.root.themeConfig`，二选一；实现取其一并保持 search 等共享项在顶层）。
- **zh / ja**：译文 markdown 放 `apps/docs/zh/`、`apps/docs/ja/`，各带自己的 `themeConfig.nav`/`sidebar`（指向 `/zh/...`、`/ja/...`）。

### 路径不对称（已知取舍）

英文正文路由是 `/content/integration/sending-traces`（因 symlink 在 content/ 下），而 zh/ja 是 `/zh/integration/sending-traces`。语言切换下拉用每 locale 的 `link` 跳转，**不做逐页对应跳转**（切语言落到该语言入口，不是"当前页的另一语言版"）。页很少，可接受。

## 翻译内容（与英文发布集对齐）

每语言三份文件：

| 文件                                                          | 内容                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/docs/zh/index.md` / `apps/docs/ja/index.md`             | home hero（name/text/tagline/actions），actions 链接指向本语言路径 |
| `apps/docs/zh/integration/sending-traces.md` / `ja/...`       | 接入指南全文译文                                                   |
| `apps/docs/zh/conventions/semantic-conventions.md` / `ja/...` | 语义约定全文译文                                                   |

- 译文内部链接全部指向本语言前缀（`/zh/...` 或 `/ja/...`），不跨回英文 `/content/`。
- 英文 `sending-traces.md` 链接到的两个外部目标（`../../scripts/example-trace.json`、`api/README`）在译文里改为指向英文门户对应位置或纯文本说明（避免新死链；具体在实现计划处理，沿用现有 `ignoreDeadLinks` 白名单）。
- **ja 译文**每篇顶部加提示块：「> 機械翻訳です。ネイティブによるレビュー待ち。」（诚实标注待校）。
- **zh-CN 译文**用全角标点（仓库约定），不加提示块（但 PR 说明为 AI 翻译）。

## 测试 / 验收

- `pnpm --filter @argus/docs build` 绿；dist 产出全套：`/`(en hero)、`/content/integration/sending-traces.html`、`/content/conventions/semantic-conventions.html`、`/zh/`、`/zh/integration/sending-traces.html`、`/zh/conventions/semantic-conventions.html`、`/ja/` 及其两页。
- 顶栏语言下拉含 English / 简体中文 / 日本語，切换可达各语言入口。
- 本地搜索仍工作；暗色模式不变；Console 外观（品牌蓝、hairline、Inter）三语一致。
- 无新死链（build 不因 dead-link 失败）。
- preview 工具三语各截图留证。
- 既有 CI 四 job（ci / docs-links / docs-build / openapi-drift）不受影响。docs-links 检查的是 `docs/**` 与根 README——译文在 `apps/docs/` 下，不在其 scope，但若 docs-links scope 含 apps/docs 需确认不引入死链（实现时核对）。

## 组件改动清单

| 文件                                               | 改动                                           |
| -------------------------------------------------- | ---------------------------------------------- |
| `apps/docs/.vitepress/config.ts`                   | 改。加 `locales`；按 locale 拆分 nav/sidebar。 |
| `apps/docs/zh/index.md`                            | 新增。中文 home hero。                         |
| `apps/docs/zh/integration/sending-traces.md`       | 新增。接入指南中文译文。                       |
| `apps/docs/zh/conventions/semantic-conventions.md` | 新增。语义约定中文译文。                       |
| `apps/docs/ja/index.md`                            | 新增。日文 home hero（含待校提示）。           |
| `apps/docs/ja/integration/sending-traces.md`       | 新增。接入指南日文译文（含待校提示）。         |
| `apps/docs/ja/conventions/semantic-conventions.md` | 新增。语义约定日文译文（含待校提示）。         |

不改 `docs/`、`@argus/design-tokens`、主题 CSS、web/server。

## 非目标（留作后续）

- 不把译文放进 `docs/`（坚持英文单源）。
- 不做逐页语言对应跳转（落语言入口即可）。
- 不翻内部文档（specs/adr/architecture 本就不发布）。
- 不引入翻译-同步 CI（译文是门户层手工资产；ja 顶部"待校"提示 + 后续人工流程承担质量）。
- 不本地化主题 chrome 的固定字串（VitePress 默认主题的"On this page"等已随 `lang` 切换内置文案；不额外定制）。
