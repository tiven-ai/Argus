# 文档防腐 CI 设计（死链检查 + 示例有效性）

> 日期：2026-06-01
> 状态：已批准方案，待写实现计划
> 范围：CI 工作流 + 一个 server 端测试。不改产品代码、不改文档内容。
> 关联：把 [`docs/README.md`](../../README.md) 的维护规则 1（单一真源 / 链接有效）与规则 3（示例必须真实）从"纪律"变为 CI 门禁。

## 背景与目标

`docs/README.md` 列了五条文档维护规则，其中两条可以自动化执行：

- **规则 3「Examples must be real」** —— 文档里的示例/命令必须真实、可复制、正确。我们已经踩过一次："7→6" —— 接入指南写 `{ "accepted": 7 }`，而 `scripts/example-trace.json` 实际是 6 个 span。
- **规则 1（隐含）链接有效** —— 文档间的相对链接必须指向真实存在的文件；改文件名忘改链接会留下死链。

目标：把这两条变成 CI 门禁。其余规则（"docs 与代码同 PR""决策入 ADR""英文单源"）是 review/流程纪律，不可干净 CI 化，本次不做。

## 数据现状（前提）

- CI 在 [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)：单 job `ci`，PR + push main 触发，步骤 typecheck → lint → test → build，带一个 Postgres service。pnpm 10 / Node 20 / turbo。
- ingest 解析器已存在且被测试覆盖：`apps/server/src/modules/ingest` 导出 `parseOtlpRequest(req): WriteTraceInput[]`、`otlpExportRequestSchema`、`OtlpParseError`（见 `apps/server/test/ingest/routes.test.ts` 的用法）。解析是纯函数，不需要 DB。
- 总 span 数 = 各 `WriteTraceInput.steps.length` 之和。
- `scripts/example-trace.json` 当前 6 个 span，resource 上有 `argus.project=demo` / `argus.service=weather-bot`。
- `docs/integration/sending-traces.md` 当前写 `{ "accepted": 6 }`。
- 仓库当前**没有**任何 markdown lint / 链接检查工具。
- ⚠️ `docs/api/README.md` 声称 `openapi.yaml` 由 CI 生成 —— 该文件与生成器目前都**不存在**，属 aspirational。本次明确**不**触碰 OpenAPI；它应是独立 sub-project。

## 两个独立单元

### 单元 A：示例 payload smoke test（vitest）

新文件 `apps/server/test/docs/example-trace.test.ts`，随现有 `pnpm test` 一起跑（不改 CI 的 test 步骤，不需要 DB、不起服务）。

读取两份产物并交叉验证：

1. **示例是合法 OTLP。** 读 `scripts/example-trace.json`，用 `otlpExportRequestSchema.parse(json)` 断言通过（schema 演进而示例没跟上 → 失败）。
2. **真实解析器能解析，得出 span 数。** 用 `parseOtlpRequest(parsed)` 解析，`actualSpanCount = results.reduce((n, r) => n + r.steps.length, 0)`，断言 `> 0`。
3. **文档声称值 == 实际值。** 读 `docs/integration/sending-traces.md`，正则抓取文档里 `{ "accepted": N }` 的 N，断言 `docStated === actualSpanCount`。

单一真源：accepted 数只在文档里书写一处；测试从文档抓取，不在测试里另写一份硬编码值（否则又制造了第二处会漂移的真源）。

路径解析：测试文件在 `apps/server/test/docs/`，用相对路径上溯到仓库根定位 `scripts/example-trace.json` 与 `docs/integration/sending-traces.md`（`import.meta.url` + 相对路径；下方实现计划给精确路径）。

正则：匹配文档代码块里的 `"accepted": 6` 形态，宽松容忍空白：`/"accepted"\s*:\s*(\d+)/`。文档里该字符串只出现一次（实现时断言恰好一处匹配，多于一处则测试失败以免抓错）。

### 单元 B：死链检查（lychee，CI 新 job）

在 `.github/workflows/ci.yml` 增加一个与 `ci` **并行**的独立 job `docs-links`（不拖慢主流程，失败定位清晰）：

- 用 `lycheeverse/lychee-action`。
- scope：`docs/**/*.md` 与根 `README.md`。
- **仅离线检查仓库内部相对链接**（`--offline`），不验证外部 URL 活性 —— 外部站点抖动会造成假失败，噪音大；我们要拦的是"指向不存在的本地文件"的死链。
- 配置写入仓库根 `lychee.toml`，固定 offline + scope + 排除（如锚点 `#...` 片段不做深检，避免对 GitHub 自动生成的 heading slug 误报）。
- 触发条件同 CI（PR + push main）。

## 不做（YAGNI / 范围外）

- 不生成 / 不校验 OpenAPI（不存在，独立项）。
- 不验证外部 URL 活性。
- 不做 markdown 风格 lint（markdownlint/remark）—— 与"防腐"无关。
- 不自动化"docs 同 PR""决策入 ADR"等流程纪律。

## 组件改动清单

| 文件                                          | 改动                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/server/test/docs/example-trace.test.ts` | 新增。示例 OTLP 合法性 + 解析 + 文档 accepted 数交叉校验。              |
| `lychee.toml`                                 | 新增（仓库根）。offline + scope + 排除配置。                            |
| `.github/workflows/ci.yml`                    | 修改。新增并行 job `docs-links`，跑 lychee-action。现有 `ci` job 不动。 |

不动产品代码、不动文档内容、不动现有 `ci` job 的步骤。

## 测试 / 验收

- **示例 smoke test：** 把 `sending-traces.md` 的 `accepted` 临时改成 7 → 测试红；改回 6 → 绿。把示例某 span 删掉但文档不改 → 测试红。
- **死链：** 在任一 md 里加一个指向不存在文件的相对链接 → `docs-links` job 红；移除后绿。
- **回归：** 本地 `pnpm test` 通过（含新测试）；`pnpm lint`、`pnpm typecheck`、`pnpm build` 不受影响。
- **CI：** `ci` 与 `docs-links` 两个 job 均绿。

## 后续（非本次）

- OpenAPI 从 Zod 生成 + CI 校验同步（独立 sub-project，兑现 `docs/api/README.md` 的承诺）。
- 文档门户生成器（sub-project 2，已排在本项之后）。
