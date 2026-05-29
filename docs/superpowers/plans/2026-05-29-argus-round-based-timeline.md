# Argus — Round-Based Timeline Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-span timeline (M2) with a per-round timeline that matches how AI agents actually work: each row is one LLM-call round, labeled by what triggered it; the right detail panel shows the round's full context (system prompt + message history + tools + trigger + LLM output + tool executions).

**Architecture:** Add a pure `computeRounds(steps)` derivation that groups spans into `Round` objects (anchored on each `llm_call` span). Replace `StepTimeline` / `StepDetail` / all per-step renderers with `RoundTimeline` + `RoundDetail`. `RoundDetail` is no longer tabbed; it's a single scrollable panel with 5 sections (Context, Trigger, LLM call, Tool execution, Raw) — Context and Raw are collapsible. The seed data is updated to a realistic 2-LLM-call pattern so the new timeline actually demonstrates rounds. URL state shifts from `?step=<stepId>` to `?round=<llmCallStepId>`.

**Tech Stack additions:** `@radix-ui/react-collapsible` for collapsible Context/Raw sections. No other new deps.

**Scope deliberately excluded:**

- Edge case: sessions with zero LLM calls (timeline shows hint message; not a primary M3.5 concern)
- Per-tool-type custom renderers (defer; round model is the priority)
- Hierarchy / parent-child indent (deferred to a later milestone if needed)
- Backend changes (none — the API still returns flat Steps; rounds are derived client-side)

**Reference spec:** [docs/superpowers/specs/2026-05-28-argus-design.md](../specs/2026-05-28-argus-design.md)
**Origin:** user feedback on M2 timeline UX (2026-05-29) — "每一条应该是一轮 LLM 调用和执行结果，timeline 中显示的是触发该轮调用的类型"

---

## File Structure (after this rework)

```
apps/server/src/cli/
└── seed.ts                                          (REWRITTEN: 2-LLM-call pattern, no assistant_message)

scripts/
└── example-trace.json                               (REWRITTEN to match seed pattern)

apps/web/src/
├── components/ui/
│   └── collapsible.tsx                              (NEW: Radix Collapsible wrapper)
├── lib/
│   └── use-session-stream.ts                        (unchanged)
├── routes/sessions/$sessionId.tsx                   (MODIFIED: URL ?round=<id>)
└── features/session-replay/
    ├── index.tsx                                    (MODIFIED: use RoundTimeline + RoundDetail)
    ├── types/
    │   └── round.ts                                 (NEW: Round interface)
    ├── lib/
    │   ├── compute-rounds.ts                        (NEW)
    │   ├── compute-rounds.test.ts                   (NEW)
    │   ├── step-helpers.ts                          (UNCHANGED — still useful)
    │   └── step-helpers.test.ts                     (UNCHANGED)
    ├── timeline/
    │   ├── round-icons.ts                           (NEW: trigger-type → icon)
    │   ├── RoundRow.tsx                             (NEW)
    │   └── RoundTimeline.tsx                        (NEW: replaces StepTimeline)
    ├── detail/
    │   ├── RoundDetail.tsx                          (NEW: replaces StepDetail; no tabs, scrollable sections)
    │   ├── RoundHeader.tsx                          (NEW: replaces StepMetaHeader)
    │   └── sections/
    │       ├── ContextSection.tsx                   (NEW: system prompt + tools + message history)
    │       ├── TriggerSection.tsx                   (NEW: user message or tool result)
    │       ├── LlmCallSection.tsx                   (NEW: text / tool_calls / stop_reason)
    │       ├── ToolExecutionsSection.tsx            (NEW: each tool call with args + result)
    │       └── RawSection.tsx                       (NEW: JSON dump of round)
    └── topbar/SessionTopbar.tsx                     (UNCHANGED)

DELETED:
├── apps/web/src/features/session-replay/renderers/             (entire folder)
├── apps/web/src/features/session-replay/detail/StepDetail.tsx
├── apps/web/src/features/session-replay/detail/StepMetaHeader.tsx
├── apps/web/src/features/session-replay/detail/EventsTab.tsx
├── apps/web/src/features/session-replay/detail/RawTab.tsx
├── apps/web/src/features/session-replay/timeline/StepRow.tsx
├── apps/web/src/features/session-replay/timeline/StepTimeline.tsx
└── apps/web/src/features/session-replay/timeline/step-icons.ts (replaced by round-icons.ts)
```

---

## Common Conventions

- All imports use `@/` alias for cross-folder references when convenient.
- Tailwind classes are mostly neutrals + accent colors. No dark mode.
- Each section component takes `{ round: Round }` and renders its slice.
- Commit messages: Conventional Commits, lowercase subject (commitlint enforces).
- Test count target after this rework: at least 13 web tests (7 step-helpers + 6 computeRounds).

---

## Task 1: Update seed to 2-LLM-call pattern + update example-trace.json

**Files:**

- Modify: `apps/server/src/cli/seed.ts` (full replacement)
- Modify: `scripts/example-trace.json` (full replacement)

### Step 1: Replace `apps/server/src/cli/seed.ts`

```ts
import { loadEnv } from '../env.js'
import { createKysely } from '../db/kysely.js'
import { PgStorage } from '../modules/storage/pg.js'

async function main() {
  const env = loadEnv()
  const db = createKysely(env.DATABASE_URL)
  const storage = new PgStorage(db)

  const now = new Date()
  const traceId = '0123456789abcdef0123456789abcdef'
  const root = '1111111111111111'

  const systemPromptText = 'You are a helpful weather assistant.'
  const userText = '今天合肥天气怎么样？'
  const toolName = 'get_weather'
  const toolArgs = { city: 'Hefei' }
  const toolResult = { temperature: 30, condition: 'Sunny' }
  const finalText = '合肥今天天气晴朗，气温 30°C。'

  const tools = [
    {
      name: toolName,
      description: 'Get the current weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  ]

  const baseMessages = [
    { role: 'system', content: systemPromptText },
    { role: 'user', content: userText },
  ]

  const assistantToolCallMessage = {
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'call_1', name: toolName, arguments: toolArgs }],
  }

  const toolResultMessage = {
    role: 'tool',
    tool_call_id: 'call_1',
    content: JSON.stringify(toolResult),
  }

  await storage.writeTrace({
    orgId: '00000000-0000-0000-0000-000000000000',
    projectName: 'demo',
    serviceName: 'weather-bot',
    traceId,
    sessionStartedAt: new Date(now.getTime() - 5_000),
    sessionEndedAt: now,
    steps: [
      // Root agent.session span (hidden in timeline)
      {
        spanId: root,
        parentSpanId: null,
        name: 'agent.session',
        kind: null,
        componentType: null,
        componentName: null,
        startedAt: new Date(now.getTime() - 5_000),
        endedAt: now,
        attributes: { 'service.name': 'weather-bot' },
        statusCode: 'OK',
        statusMessage: null,
        events: [],
      },
      // system_prompt span (hidden in timeline; context only)
      {
        spanId: '2222222222222222',
        parentSpanId: root,
        name: 'system_prompt',
        kind: 'system_prompt',
        componentType: null,
        componentName: null,
        startedAt: new Date(now.getTime() - 5_000),
        endedAt: new Date(now.getTime() - 4_900),
        attributes: { 'argus.step.kind': 'system_prompt' },
        statusCode: 'OK',
        statusMessage: null,
        events: [
          {
            name: 'argus.input',
            ts: new Date(now.getTime() - 4_950),
            attributes: { text: systemPromptText },
          },
        ],
      },
      // user_message span (trigger of Round 1; shown in timeline as row label)
      {
        spanId: '3333333333333333',
        parentSpanId: root,
        name: 'user_message',
        kind: 'user_message',
        componentType: null,
        componentName: null,
        startedAt: new Date(now.getTime() - 4_500),
        endedAt: new Date(now.getTime() - 4_500),
        attributes: { 'argus.step.kind': 'user_message' },
        statusCode: 'OK',
        statusMessage: null,
        events: [
          {
            name: 'argus.input',
            ts: new Date(now.getTime() - 4_500),
            attributes: { text: userText },
          },
        ],
      },
      // llm.chat #1 — Round 1 LLM call (anchor)
      {
        spanId: '4444444444444444',
        parentSpanId: root,
        name: 'llm.chat',
        kind: 'llm_call',
        componentType: 'llm',
        componentName: 'claude-3-7-sonnet',
        startedAt: new Date(now.getTime() - 4_400),
        endedAt: new Date(now.getTime() - 3_200),
        attributes: {
          'argus.step.kind': 'llm_call',
          'argus.component.type': 'llm',
          'argus.component.name': 'claude-3-7-sonnet',
          'gen_ai.request.model': 'claude-3-7-sonnet',
          'gen_ai.usage.input_tokens': 120,
          'gen_ai.usage.output_tokens': 45,
        },
        statusCode: 'OK',
        statusMessage: null,
        events: [
          {
            name: 'argus.input',
            ts: new Date(now.getTime() - 4_400),
            attributes: {
              messages: baseMessages,
              tools,
            },
          },
          {
            name: 'argus.output',
            ts: new Date(now.getTime() - 3_200),
            attributes: {
              tool_calls: [{ id: 'call_1', name: toolName, arguments: toolArgs }],
              stop_reason: 'tool_use',
            },
          },
        ],
      },
      // tool.get_weather — Round 1 tool execution (becomes trigger of Round 2)
      {
        spanId: '5555555555555555',
        parentSpanId: root,
        name: 'tool.get_weather',
        kind: 'tool_call',
        componentType: 'custom_tool',
        componentName: toolName,
        startedAt: new Date(now.getTime() - 3_000),
        endedAt: new Date(now.getTime() - 2_500),
        attributes: {
          'argus.step.kind': 'tool_call',
          'argus.component.type': 'custom_tool',
          'argus.component.name': toolName,
        },
        statusCode: 'OK',
        statusMessage: null,
        events: [
          {
            name: 'argus.input',
            ts: new Date(now.getTime() - 3_000),
            attributes: toolArgs,
          },
          {
            name: 'argus.output',
            ts: new Date(now.getTime() - 2_500),
            attributes: toolResult,
          },
        ],
      },
      // llm.chat #2 — Round 2 LLM call (with tool result, produces final text)
      {
        spanId: '6666666666666666',
        parentSpanId: root,
        name: 'llm.chat',
        kind: 'llm_call',
        componentType: 'llm',
        componentName: 'claude-3-7-sonnet',
        startedAt: new Date(now.getTime() - 2_400),
        endedAt: new Date(now.getTime() - 100),
        attributes: {
          'argus.step.kind': 'llm_call',
          'argus.component.type': 'llm',
          'argus.component.name': 'claude-3-7-sonnet',
          'gen_ai.request.model': 'claude-3-7-sonnet',
          'gen_ai.usage.input_tokens': 180,
          'gen_ai.usage.output_tokens': 30,
        },
        statusCode: 'OK',
        statusMessage: null,
        events: [
          {
            name: 'argus.input',
            ts: new Date(now.getTime() - 2_400),
            attributes: {
              messages: [...baseMessages, assistantToolCallMessage, toolResultMessage],
              tools,
            },
          },
          {
            name: 'argus.output',
            ts: new Date(now.getTime() - 100),
            attributes: {
              text: finalText,
              stop_reason: 'end_turn',
            },
          },
        ],
      },
    ],
  })

  console.log(`Seed complete. trace_id=${traceId}`)
  await db.destroy()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

### Step 2: Replace `scripts/example-trace.json`

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "argus.project", "value": { "stringValue": "demo" } },
          { "key": "argus.service", "value": { "stringValue": "weather-bot" } },
          { "key": "service.name", "value": { "stringValue": "weather-bot" } }
        ]
      },
      "scopeSpans": [
        {
          "scope": { "name": "argus-example" },
          "spans": [
            {
              "traceId": "abcdef0123456789abcdef0123456789",
              "spanId": "1111111111111111",
              "name": "agent.session",
              "startTimeUnixNano": "1779955200000000000",
              "endTimeUnixNano": "1779955205000000000",
              "status": { "code": 1 }
            },
            {
              "traceId": "abcdef0123456789abcdef0123456789",
              "spanId": "2222222222222222",
              "parentSpanId": "1111111111111111",
              "name": "system_prompt",
              "startTimeUnixNano": "1779955200000000000",
              "endTimeUnixNano": "1779955200100000000",
              "attributes": [
                { "key": "argus.step.kind", "value": { "stringValue": "system_prompt" } }
              ],
              "events": [
                {
                  "timeUnixNano": "1779955200050000000",
                  "name": "argus.input",
                  "attributes": [
                    {
                      "key": "text",
                      "value": { "stringValue": "You are a helpful weather assistant." }
                    }
                  ]
                }
              ],
              "status": { "code": 1 }
            },
            {
              "traceId": "abcdef0123456789abcdef0123456789",
              "spanId": "3333333333333333",
              "parentSpanId": "1111111111111111",
              "name": "user_message",
              "startTimeUnixNano": "1779955200500000000",
              "endTimeUnixNano": "1779955200500000000",
              "attributes": [
                { "key": "argus.step.kind", "value": { "stringValue": "user_message" } }
              ],
              "events": [
                {
                  "timeUnixNano": "1779955200500000000",
                  "name": "argus.input",
                  "attributes": [
                    { "key": "text", "value": { "stringValue": "今天合肥天气怎么样？" } }
                  ]
                }
              ],
              "status": { "code": 1 }
            },
            {
              "traceId": "abcdef0123456789abcdef0123456789",
              "spanId": "4444444444444444",
              "parentSpanId": "1111111111111111",
              "name": "llm.chat",
              "startTimeUnixNano": "1779955200600000000",
              "endTimeUnixNano": "1779955201800000000",
              "attributes": [
                { "key": "argus.step.kind", "value": { "stringValue": "llm_call" } },
                { "key": "argus.component.type", "value": { "stringValue": "llm" } },
                { "key": "argus.component.name", "value": { "stringValue": "claude-3-7-sonnet" } },
                { "key": "gen_ai.request.model", "value": { "stringValue": "claude-3-7-sonnet" } },
                { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "120" } },
                { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "45" } }
              ],
              "events": [
                {
                  "timeUnixNano": "1779955201800000000",
                  "name": "argus.output",
                  "attributes": [
                    {
                      "key": "stop_reason",
                      "value": { "stringValue": "tool_use" }
                    }
                  ]
                }
              ],
              "status": { "code": 1 }
            },
            {
              "traceId": "abcdef0123456789abcdef0123456789",
              "spanId": "5555555555555555",
              "parentSpanId": "1111111111111111",
              "name": "tool.get_weather",
              "startTimeUnixNano": "1779955202000000000",
              "endTimeUnixNano": "1779955202500000000",
              "attributes": [
                { "key": "argus.step.kind", "value": { "stringValue": "tool_call" } },
                { "key": "argus.component.type", "value": { "stringValue": "custom_tool" } },
                { "key": "argus.component.name", "value": { "stringValue": "get_weather" } }
              ],
              "status": { "code": 1 }
            },
            {
              "traceId": "abcdef0123456789abcdef0123456789",
              "spanId": "6666666666666666",
              "parentSpanId": "1111111111111111",
              "name": "llm.chat",
              "startTimeUnixNano": "1779955202600000000",
              "endTimeUnixNano": "1779955204900000000",
              "attributes": [
                { "key": "argus.step.kind", "value": { "stringValue": "llm_call" } },
                { "key": "argus.component.type", "value": { "stringValue": "llm" } },
                { "key": "argus.component.name", "value": { "stringValue": "claude-3-7-sonnet" } },
                { "key": "gen_ai.request.model", "value": { "stringValue": "claude-3-7-sonnet" } },
                { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "180" } },
                { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "30" } }
              ],
              "events": [
                {
                  "timeUnixNano": "1779955204900000000",
                  "name": "argus.output",
                  "attributes": [
                    {
                      "key": "text",
                      "value": { "stringValue": "合肥今天天气晴朗，气温 30°C。" }
                    },
                    {
                      "key": "stop_reason",
                      "value": { "stringValue": "end_turn" }
                    }
                  ]
                }
              ],
              "status": { "code": 1 }
            }
          ]
        }
      ]
    }
  ]
}
```

(The example-trace.json doesn't need the full messages array embedded in argus.input events — the new model derives Round triggers from sibling spans, not from message arrays. This keeps the example payload compact. Seed has the rich version for UI verification.)

### Step 3: Smoke-test

```bash
pnpm db:up
sleep 5
pnpm db:migrate
pnpm db:seed

# Verify 6 steps (was 6 before too — count unchanged, structure changed)
docker exec argus-postgres psql -U argus -d argus -c "SELECT COUNT(*) FROM steps;"

# Verify the two llm_call spans
docker exec argus-postgres psql -U argus -d argus -c "SELECT span_id, name, kind FROM steps WHERE kind = 'llm_call' ORDER BY started_at;"

pnpm db:down
```

Expected:

- 6 steps total (same as before — we replaced 1 assistant_message with 1 llm.chat)
- Two `llm_call` rows with span_ids `4444...` and `6666...`

### Step 4: Commit

```bash
git add apps/server/src/cli/seed.ts scripts/example-trace.json
git commit -m "feat(server): seed + example use realistic 2-LLM-call round pattern"
```

---

## Task 2: Round type + computeRounds + tests

**Files:**

- Create: `apps/web/src/features/session-replay/types/round.ts`
- Create: `apps/web/src/features/session-replay/lib/compute-rounds.ts`
- Create: `apps/web/src/features/session-replay/lib/compute-rounds.test.ts`

### Step 1: Create `types/round.ts`

```ts
import type { Step } from '@argus/shared-types'

/**
 * A logical "round" of agent interaction, anchored by one LLM call.
 * - `llmCall` is the anchoring span.
 * - `trigger` is the span that kicked off this round (user_message or a tool_call
 *   from the previous round). Undefined for the very first round if no preceding
 *   user_message exists.
 * - `toolExecutions` are tool_call spans that ran after this LLM call's
 *   `tool_calls` output and before the next round's LLM call. They effectively
 *   become the trigger of the next round.
 */
export interface Round {
  id: string // = llmCall.id
  llmCall: Step
  trigger: Step | undefined
  toolExecutions: Step[]
}
```

### Step 2: Write `lib/compute-rounds.test.ts` (TDD)

```ts
import { describe, expect, it } from 'vitest'
import type { Step } from '@argus/shared-types'
import { computeRounds } from './compute-rounds'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: overrides.id ?? overrides.spanId ?? Math.random().toString(36).slice(2),
    spanId: overrides.spanId ?? 'a'.repeat(16),
    parentSpanId: null,
    name: 'test',
    kind: null,
    componentType: null,
    componentName: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    attributes: {},
    statusCode: 'OK',
    statusMessage: null,
    events: [],
    ...overrides,
  }
}

describe('computeRounds', () => {
  it('returns [] when there are no LLM calls', () => {
    const steps = [makeStep({ id: 'u', kind: 'user_message' })]
    expect(computeRounds(steps)).toEqual([])
  })

  it('returns one round per LLM call', () => {
    const steps = [
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      }),
      makeStep({
        id: 'l2',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:02Z',
        endedAt: '2026-01-01T00:00:03Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds.map((r) => r.id)).toEqual(['l1', 'l2'])
  })

  it('round.trigger is the most recent user_message before the LLM call', () => {
    const steps = [
      makeStep({
        id: 'u',
        kind: 'user_message',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:00Z',
      }),
      makeStep({
        id: 'sp',
        kind: 'system_prompt',
        startedAt: '2026-01-01T00:00:00.5Z',
        endedAt: '2026-01-01T00:00:00.5Z',
      }),
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:01Z',
        endedAt: '2026-01-01T00:00:02Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.trigger?.id).toBe('u')
  })

  it("round 2's trigger is round 1's tool_call (not the original user_message)", () => {
    const steps = [
      makeStep({
        id: 'u',
        kind: 'user_message',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:00Z',
      }),
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:01Z',
        endedAt: '2026-01-01T00:00:02Z',
      }),
      makeStep({
        id: 't1',
        kind: 'tool_call',
        startedAt: '2026-01-01T00:00:03Z',
        endedAt: '2026-01-01T00:00:04Z',
      }),
      makeStep({
        id: 'l2',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:05Z',
        endedAt: '2026-01-01T00:00:06Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds).toHaveLength(2)
    expect(rounds[0]?.trigger?.id).toBe('u')
    expect(rounds[1]?.trigger?.id).toBe('t1')
  })

  it('round.toolExecutions includes only tool_calls between this and next LLM call', () => {
    const steps = [
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      }),
      makeStep({
        id: 't1',
        kind: 'tool_call',
        startedAt: '2026-01-01T00:00:02Z',
        endedAt: '2026-01-01T00:00:03Z',
      }),
      makeStep({
        id: 't2',
        kind: 'tool_call',
        startedAt: '2026-01-01T00:00:03.5Z',
        endedAt: '2026-01-01T00:00:04Z',
      }),
      makeStep({
        id: 'l2',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:05Z',
        endedAt: '2026-01-01T00:00:06Z',
      }),
      makeStep({
        id: 't3',
        kind: 'tool_call',
        startedAt: '2026-01-01T00:00:07Z',
        endedAt: '2026-01-01T00:00:08Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds[0]?.toolExecutions.map((s) => s.id)).toEqual(['t1', 't2'])
    expect(rounds[1]?.toolExecutions.map((s) => s.id)).toEqual(['t3'])
  })

  it('treats componentType=llm as an LLM call even if kind is null', () => {
    const steps = [
      makeStep({
        id: 'l1',
        kind: null,
        componentType: 'llm',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.id).toBe('l1')
  })

  it('handles input order regardless (uses startedAt for ordering)', () => {
    const steps = [
      makeStep({
        id: 'l2',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:05Z',
        endedAt: '2026-01-01T00:00:06Z',
      }),
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      }),
      makeStep({
        id: 'u',
        kind: 'user_message',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:00Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds.map((r) => r.id)).toEqual(['l1', 'l2'])
  })
})
```

### Step 3: Run, confirm FAIL

```bash
pnpm --filter @argus/web test
```

Expected: FAIL — `./compute-rounds` not found.

### Step 4: Create `lib/compute-rounds.ts`

```ts
import type { Step } from '@argus/shared-types'
import type { Round } from '../types/round'

function isLlmCall(step: Step): boolean {
  return step.kind === 'llm_call' || step.componentType === 'llm'
}

function isTriggerCandidate(step: Step): boolean {
  return step.kind === 'user_message' || step.kind === 'tool_call'
}

export function computeRounds(steps: Step[]): Round[] {
  const sorted = [...steps].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const llmCalls = sorted.filter(isLlmCall)
  if (llmCalls.length === 0) return []

  const llmIndices = new Set(llmCalls.map((c) => c.id))

  return llmCalls.map((llm, i) => {
    // Trigger: most recent trigger-candidate strictly before this LLM call's start.
    let trigger: Step | undefined
    for (const s of sorted) {
      if (s.id === llm.id) break
      if (s.startedAt >= llm.startedAt) break
      if (isTriggerCandidate(s)) trigger = s
    }

    // Tool executions: tool_calls that started at or after this LLM call's end
    // and strictly before the next LLM call's start. (We use `>=` here so a tool
    // that fires the same instant the LLM ends still counts.)
    const nextStart =
      i + 1 < llmCalls.length ? llmCalls[i + 1]!.startedAt : '9999-12-31T23:59:59.999Z'
    const toolExecutions = sorted.filter(
      (s) =>
        s.kind === 'tool_call' &&
        s.startedAt >= llm.endedAt &&
        s.startedAt < nextStart &&
        !llmIndices.has(s.id),
    )

    return {
      id: llm.id,
      llmCall: llm,
      trigger,
      toolExecutions,
    }
  })
}
```

### Step 5: Run, confirm PASS

```bash
pnpm --filter @argus/web test
```

Expected: PASS — 14 web tests total (7 step-helpers + 7 new computeRounds).

### Step 6: Commit

```bash
git add apps/web/src/features/session-replay/types apps/web/src/features/session-replay/lib
git commit -m "feat(web): round type + computeRounds derivation + tests"
```

---

## Task 3: Collapsible shadcn component + radix dep

**Files:**

- Modify: `apps/web/package.json` (add `@radix-ui/react-collapsible`)
- Create: `apps/web/src/components/ui/collapsible.tsx`

### Step 1: Update `apps/web/package.json` — add `@radix-ui/react-collapsible` to dependencies

Replace the file with (full version with the new dep):

```json
{
  "name": "@argus/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@argus/shared-types": "workspace:*",
    "@radix-ui/react-collapsible": "^1.1.0",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@tanstack/react-query": "^5.50.0",
    "@tanstack/react-router": "^1.60.0",
    "@tanstack/react-virtual": "^3.10.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.460.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.5.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@argus/eslint-config": "workspace:*",
    "@argus/tsconfig": "workspace:*",
    "@tailwindcss/vite": "^4.0.0",
    "@tanstack/router-devtools": "^1.60.0",
    "@tanstack/router-plugin": "^1.60.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "eslint": "^9.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```

### Step 2: `pnpm install`

```bash
pnpm install
```

### Step 3: Create `apps/web/src/components/ui/collapsible.tsx`

```tsx
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger
const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
```

### Step 4: Typecheck

```bash
pnpm --filter @argus/web typecheck
```

Expected: 0 errors.

### Step 5: Commit

```bash
git add apps/web/package.json apps/web/src/components/ui/collapsible.tsx pnpm-lock.yaml
git commit -m "feat(web): add radix collapsible shadcn primitive"
```

---

## Task 4: Round detail sections (ContextSection, TriggerSection, LlmCallSection, ToolExecutionsSection, RawSection)

All 5 sections in one task because they're parallel components of similar size.

**Files:**

- Create: `apps/web/src/features/session-replay/detail/sections/ContextSection.tsx`
- Create: `apps/web/src/features/session-replay/detail/sections/TriggerSection.tsx`
- Create: `apps/web/src/features/session-replay/detail/sections/LlmCallSection.tsx`
- Create: `apps/web/src/features/session-replay/detail/sections/ToolExecutionsSection.tsx`
- Create: `apps/web/src/features/session-replay/detail/sections/RawSection.tsx`

### Step 1: Create `sections/ContextSection.tsx`

```tsx
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

function MessageRow({
  role,
  content,
  toolCalls,
}: {
  role: string
  content?: string
  toolCalls?: unknown[]
}) {
  return (
    <li className="border rounded p-2 text-sm">
      <p className="text-xs text-neutral-500 mb-1 uppercase tracking-wide">{role}</p>
      {content && content.length > 0 && (
        <pre className="whitespace-pre-wrap text-sm">{content}</pre>
      )}
      {toolCalls && toolCalls.length > 0 && (
        <pre className="text-xs bg-neutral-50 border mt-1 p-2 rounded overflow-auto">
          {JSON.stringify(toolCalls, null, 2)}
        </pre>
      )}
    </li>
  )
}

export function ContextSection({ round }: Props) {
  const input = findEvent(round.llmCall, 'argus.input')?.attributes ?? {}
  const messages = Array.isArray(input.messages) ? input.messages : []
  const tools = Array.isArray(input.tools) ? input.tools : []

  // System prompt: prefer explicit `system_prompt` on input, fall back to first
  // message with role=system.
  const explicit = typeof input.system_prompt === 'string' ? input.system_prompt : null
  const systemFromMessages =
    messages.find((m) => (m as { role?: unknown }).role === 'system') ?? null
  const systemPrompt =
    explicit ??
    (typeof (systemFromMessages as { content?: unknown })?.content === 'string'
      ? (systemFromMessages as { content: string }).content
      : null)

  const nonSystemMessages = messages.filter((m) => (m as { role?: unknown }).role !== 'system')

  return (
    <div className="space-y-4">
      {systemPrompt && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">System prompt</h4>
          <pre className="text-sm bg-neutral-50 border p-3 rounded whitespace-pre-wrap">
            {systemPrompt}
          </pre>
        </div>
      )}
      {tools.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Tools available</h4>
          <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
            {JSON.stringify(tools, null, 2)}
          </pre>
        </div>
      )}
      {nonSystemMessages.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Message history</h4>
          <ul className="space-y-2">
            {nonSystemMessages.map((m, i) => {
              const obj = m as {
                role?: unknown
                content?: unknown
                tool_calls?: unknown[]
              }
              return (
                <MessageRow
                  key={i}
                  role={String(obj.role ?? 'unknown')}
                  content={typeof obj.content === 'string' ? obj.content : undefined}
                  toolCalls={Array.isArray(obj.tool_calls) ? obj.tool_calls : undefined}
                />
              )
            })}
          </ul>
        </div>
      )}
      {!systemPrompt && tools.length === 0 && nonSystemMessages.length === 0 && (
        <p className="text-neutral-500 text-sm">(no context captured for this round)</p>
      )}
    </div>
  )
}
```

### Step 2: Create `sections/TriggerSection.tsx`

```tsx
import { User, Wrench } from 'lucide-react'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function TriggerSection({ round }: Props) {
  const t = round.trigger
  if (!t) {
    return (
      <p className="text-neutral-500 text-sm">
        (initial round — no preceding user message or tool result)
      </p>
    )
  }

  if (t.kind === 'user_message') {
    const text = String(findEvent(t, 'argus.input')?.attributes.text ?? '(no text)')
    return (
      <div className="flex gap-3 items-start">
        <div className="rounded-full bg-blue-100 p-2 shrink-0">
          <User className="h-4 w-4 text-blue-700" />
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 max-w-prose whitespace-pre-wrap text-sm">
          {text}
        </div>
      </div>
    )
  }

  if (t.kind === 'tool_call') {
    const toolName = t.componentName ?? t.name
    const output = findEvent(t, 'argus.output')?.attributes ?? {}
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Wrench className="h-4 w-4" />
          <span>
            Tool result · <span className="font-mono">{toolName}</span>
          </span>
        </div>
        <pre className="text-xs bg-green-50 border border-green-100 p-3 rounded overflow-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
      {JSON.stringify(t, null, 2)}
    </pre>
  )
}
```

### Step 3: Create `sections/LlmCallSection.tsx`

```tsx
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function LlmCallSection({ round }: Props) {
  const output = findEvent(round.llmCall, 'argus.output')?.attributes ?? {}
  const text = typeof output.text === 'string' ? output.text : undefined
  const toolCalls = Array.isArray(output.tool_calls) ? output.tool_calls : undefined
  const stopReason = typeof output.stop_reason === 'string' ? output.stop_reason : undefined

  return (
    <div className="space-y-4">
      {text && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Text</h4>
          <pre className="text-sm bg-amber-50 border border-amber-100 p-3 rounded whitespace-pre-wrap">
            {text}
          </pre>
        </div>
      )}
      {toolCalls && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Tool calls</h4>
          <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
            {JSON.stringify(toolCalls, null, 2)}
          </pre>
        </div>
      )}
      {stopReason && <p className="text-xs text-neutral-500">stop: {stopReason}</p>}
      {!text && !toolCalls && (
        <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  )
}
```

### Step 4: Create `sections/ToolExecutionsSection.tsx`

```tsx
import { Wrench } from 'lucide-react'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function ToolExecutionsSection({ round }: Props) {
  if (round.toolExecutions.length === 0) {
    return <p className="text-neutral-500 text-sm">(no tool executions)</p>
  }
  return (
    <ul className="space-y-4">
      {round.toolExecutions.map((t) => {
        const input = findEvent(t, 'argus.input')?.attributes ?? {}
        const output = findEvent(t, 'argus.output')?.attributes
        const toolName = t.componentName ?? t.name
        return (
          <li key={t.id} className="border rounded p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Wrench className="h-4 w-4 text-neutral-500" />
              <span className="font-mono">{toolName}</span>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1 uppercase">Input</p>
              <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1 uppercase">Output</p>
              {output ? (
                <pre className="text-xs bg-green-50 border border-green-100 p-2 rounded overflow-auto">
                  {JSON.stringify(output, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-neutral-500">(no output)</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
```

### Step 5: Create `sections/RawSection.tsx`

```tsx
import type { Round } from '../../types/round'

interface Props {
  round: Round
}

export function RawSection({ round }: Props) {
  // Combine the round into a single readable JSON dump.
  const payload = {
    id: round.id,
    trigger: round.trigger,
    llmCall: round.llmCall,
    toolExecutions: round.toolExecutions,
  }
  return (
    <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  )
}
```

### Step 6: Typecheck

```bash
pnpm --filter @argus/web typecheck
```

Expected: 0 errors.

### Step 7: Commit

```bash
git add apps/web/src/features/session-replay/detail/sections
git commit -m "feat(web): round detail sections (context/trigger/llm/tools/raw)"
```

---

## Task 5: RoundHeader + RoundDetail composer

**Files:**

- Create: `apps/web/src/features/session-replay/detail/RoundHeader.tsx`
- Create: `apps/web/src/features/session-replay/detail/RoundDetail.tsx`

### Step 1: Create `detail/RoundHeader.tsx`

```tsx
import type { Round } from '../types/round'
import { Badge } from '@/components/ui/badge'
import { durationMs, formatDuration, tokenUsage } from '../lib/step-helpers'

interface Props {
  round: Round
  index: number
  total: number
}

function statusVariant(code: string) {
  if (code === 'OK') return 'default' as const
  if (code === 'ERROR') return 'destructive' as const
  return 'secondary' as const
}

export function RoundHeader({ round, index, total }: Props) {
  const tokens = tokenUsage(round.llmCall)
  const model = String(
    round.llmCall.attributes['gen_ai.request.model'] ?? round.llmCall.componentName ?? '',
  )
  return (
    <div className="space-y-2 pb-3 border-b">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <h3 className="text-base font-semibold truncate">
          Round {index + 1} / {total}
        </h3>
        <span className="text-xs font-mono text-neutral-400 shrink-0">
          {round.llmCall.spanId.slice(0, 12)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-500">
        <Badge variant={statusVariant(round.llmCall.statusCode)}>{round.llmCall.statusCode}</Badge>
        <span>{formatDuration(durationMs(round.llmCall))}</span>
        {model && <span>· {model}</span>}
        {tokens && (
          <span>
            · tokens: {tokens.input}/{tokens.output}
          </span>
        )}
        {round.toolExecutions.length > 0 && <span>· {round.toolExecutions.length} tool exec</span>}
      </div>
    </div>
  )
}
```

### Step 2: Create `detail/RoundDetail.tsx`

```tsx
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Round } from '../types/round'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RoundHeader } from './RoundHeader'
import { ContextSection } from './sections/ContextSection'
import { TriggerSection } from './sections/TriggerSection'
import { LlmCallSection } from './sections/LlmCallSection'
import { ToolExecutionsSection } from './sections/ToolExecutionsSection'
import { RawSection } from './sections/RawSection'

interface Props {
  round: Round
  index: number
  total: number
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
      <span aria-hidden="true">{icon}</span>
      <span>{title}</span>
    </h4>
  )
}

function CollapsibleSectionHeader({
  icon,
  title,
  open,
}: {
  icon: string
  title: string
  open: boolean
}) {
  return (
    <h4 className="text-sm font-semibold flex items-center gap-2 cursor-pointer select-none hover:text-neutral-900 text-neutral-600">
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      <span aria-hidden="true">{icon}</span>
      <span>{title}</span>
    </h4>
  )
}

export function RoundDetail({ round, index, total }: Props) {
  return (
    <div className="h-full overflow-auto p-4 space-y-5">
      <RoundHeader round={round} index={index} total={total} />

      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            <CollapsibleSectionHeader icon="📋" title="Context" open={false} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ContextSection round={round} />
        </CollapsibleContent>
      </Collapsible>

      <section>
        <SectionHeader icon="⚡" title="Trigger" />
        <TriggerSection round={round} />
      </section>

      <section>
        <SectionHeader icon="🧠" title="LLM call" />
        <LlmCallSection round={round} />
      </section>

      {round.toolExecutions.length > 0 && (
        <section>
          <SectionHeader icon="🔧" title="Tool execution" />
          <ToolExecutionsSection round={round} />
        </section>
      )}

      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            <CollapsibleSectionHeader icon="🗂️" title="Raw" open={false} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <RawSection round={round} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
```

### Step 3: Typecheck

```bash
pnpm --filter @argus/web typecheck
```

Expected: 0 errors.

### Step 4: Commit

```bash
git add apps/web/src/features/session-replay/detail/RoundHeader.tsx \
        apps/web/src/features/session-replay/detail/RoundDetail.tsx
git commit -m "feat(web): round detail composer with collapsible context + raw"
```

---

## Task 6: Round timeline (icons, row, virtualized list)

**Files:**

- Create: `apps/web/src/features/session-replay/timeline/round-icons.ts`
- Create: `apps/web/src/features/session-replay/timeline/RoundRow.tsx`
- Create: `apps/web/src/features/session-replay/timeline/RoundTimeline.tsx`

### Step 1: Create `timeline/round-icons.ts`

```ts
import { Bot, User, Wrench, type LucideIcon } from 'lucide-react'
import type { Round } from '../types/round'

export function iconForRoundTrigger(round: Round): LucideIcon {
  if (!round.trigger) return Bot
  if (round.trigger.kind === 'user_message') return User
  if (round.trigger.kind === 'tool_call') return Wrench
  return Bot
}

export function labelForRoundTrigger(round: Round): string {
  if (!round.trigger) return 'Initial'
  if (round.trigger.kind === 'user_message') return 'User'
  if (round.trigger.kind === 'tool_call') {
    const name = round.trigger.componentName ?? round.trigger.name
    return `Tool result · ${name}`
  }
  return round.trigger.kind ?? round.trigger.name
}
```

### Step 2: Create `timeline/RoundRow.tsx`

```tsx
import type { Round } from '../types/round'
import { cn } from '@/lib/utils'
import { durationMs, findEvent, formatDuration } from '../lib/step-helpers'
import { iconForRoundTrigger, labelForRoundTrigger } from './round-icons'

interface Props {
  round: Round
  index: number
  active: boolean
  onClick: () => void
}

function snippetForTrigger(round: Round): string | null {
  if (!round.trigger) return null
  if (round.trigger.kind === 'user_message') {
    const text = findEvent(round.trigger, 'argus.input')?.attributes.text
    return typeof text === 'string' ? text : null
  }
  if (round.trigger.kind === 'tool_call') {
    const output = findEvent(round.trigger, 'argus.output')?.attributes
    if (output && typeof output === 'object') {
      const summary = JSON.stringify(output)
      return summary.length > 80 ? summary.slice(0, 80) + '…' : summary
    }
  }
  return null
}

export function RoundRow({ round, index, active, onClick }: Props) {
  const Icon = iconForRoundTrigger(round)
  const label = labelForRoundTrigger(round)
  const snippet = snippetForTrigger(round)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 px-3 py-2 text-left border-l-2 transition-colors',
        active ? 'bg-blue-50 border-l-blue-500' : 'border-l-transparent hover:bg-neutral-50',
      )}
    >
      <span className="text-xs text-neutral-400 w-6 shrink-0 mt-0.5 tabular-nums">{index + 1}</span>
      <Icon className="h-4 w-4 mt-0.5 text-neutral-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {snippet && <p className="text-xs text-neutral-500 truncate">{snippet}</p>}
      </div>
      <div className="text-xs text-neutral-400 shrink-0 tabular-nums">
        {formatDuration(durationMs(round.llmCall))}
      </div>
    </button>
  )
}
```

### Step 3: Create `timeline/RoundTimeline.tsx`

```tsx
import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Round } from '../types/round'
import { RoundRow } from './RoundRow'

interface Props {
  rounds: Round[]
  activeRoundId: string | undefined
  onSelect: (roundId: string) => void
}

export function RoundTimeline({ rounds, activeRoundId, onSelect }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rounds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 6,
  })

  const lastScrolledRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!activeRoundId || activeRoundId === lastScrolledRef.current) return
    const i = rounds.findIndex((r) => r.id === activeRoundId)
    if (i >= 0) {
      virtualizer.scrollToIndex(i, { align: 'center' })
      lastScrolledRef.current = activeRoundId
    }
    // virtualizer intentionally omitted from deps to avoid scroll-storm under streaming
  }, [activeRoundId, rounds])

  if (rounds.length === 0) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        <p>No rounds yet.</p>
        <p className="mt-2">
          Rounds appear when a session contains at least one LLM call. Try{' '}
          <code className="bg-neutral-100 px-1 rounded">pnpm db:seed</code>.
        </p>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const round = rounds[vi.index]
          if (!round) return null
          return (
            <div
              key={vi.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <RoundRow
                round={round}
                index={vi.index}
                active={round.id === activeRoundId}
                onClick={() => onSelect(round.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

### Step 4: Typecheck

```bash
pnpm --filter @argus/web typecheck
```

Expected: 0 errors.

### Step 5: Commit

```bash
git add apps/web/src/features/session-replay/timeline/round-icons.ts \
        apps/web/src/features/session-replay/timeline/RoundRow.tsx \
        apps/web/src/features/session-replay/timeline/RoundTimeline.tsx
git commit -m "feat(web): round timeline with trigger-based row labels"
```

---

## Task 7: SessionReplay integration + URL ?round= + delete obsolete files

**Files:**

- Modify: `apps/web/src/features/session-replay/index.tsx` (use RoundTimeline + RoundDetail; derive rounds via computeRounds)
- Modify: `apps/web/src/routes/sessions/$sessionId.tsx` (URL `?round=` instead of `?step=`)
- Delete: `apps/web/src/features/session-replay/renderers/` (entire folder)
- Delete: `apps/web/src/features/session-replay/detail/StepDetail.tsx`
- Delete: `apps/web/src/features/session-replay/detail/StepMetaHeader.tsx`
- Delete: `apps/web/src/features/session-replay/detail/EventsTab.tsx`
- Delete: `apps/web/src/features/session-replay/detail/RawTab.tsx`
- Delete: `apps/web/src/features/session-replay/timeline/StepRow.tsx`
- Delete: `apps/web/src/features/session-replay/timeline/StepTimeline.tsx`
- Delete: `apps/web/src/features/session-replay/timeline/step-icons.ts`
- Modify: `CLAUDE.md` (update the "Adding a step renderer" section — it's now obsolete; replace with the round model)

### Step 1: Replace `apps/web/src/features/session-replay/index.tsx`

```tsx
import { useMemo } from 'react'
import type { SessionSummary, Step } from '@argus/shared-types'
import { SessionTopbar } from './topbar/SessionTopbar'
import { RoundDetail } from './detail/RoundDetail'
import { RoundTimeline } from './timeline/RoundTimeline'
import { computeRounds } from './lib/compute-rounds'

interface Props {
  session: SessionSummary
  steps: Step[]
  activeRoundId: string | undefined
  connected: boolean
  onSelectRound: (id: string) => void
}

export function SessionReplay({ session, steps, activeRoundId, connected, onSelectRound }: Props) {
  const rounds = useMemo(() => computeRounds(steps), [steps])
  const activeRound = rounds.find((r) => r.id === activeRoundId) ?? rounds[0]
  const activeIndex = activeRound ? rounds.indexOf(activeRound) : -1

  return (
    <div className="h-full flex flex-col">
      <SessionTopbar session={session} steps={steps} connected={connected} />
      <div className="flex-1 grid grid-cols-[380px_1fr] overflow-hidden">
        <aside className="border-r overflow-hidden">
          <RoundTimeline rounds={rounds} activeRoundId={activeRound?.id} onSelect={onSelectRound} />
        </aside>
        <main className="overflow-hidden">
          {activeRound ? (
            <RoundDetail round={activeRound} index={activeIndex} total={rounds.length} />
          ) : (
            <p className="p-6 text-neutral-500 text-sm">
              (no rounds in this session — needs at least one LLM call)
            </p>
          )}
        </main>
      </div>
    </div>
  )
}
```

### Step 2: Replace `apps/web/src/routes/sessions/$sessionId.tsx`

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchSession } from '../../lib/api'
import { useSessionStream } from '../../lib/use-session-stream'
import { SessionReplay } from '../../features/session-replay'

const searchSchema = z.object({
  round: z.string().optional(),
})

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: searchSchema,
  component: SessionDetail,
})

function SessionDetail() {
  const { sessionId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })
  const stream = useSessionStream(sessionId)

  if (isLoading) return <div className="p-6 text-neutral-500">Loading…</div>
  if (error) return <div className="p-6 text-red-600">Error: {String(error)}</div>
  if (!data) return <div className="p-6">Not found</div>

  return (
    <SessionReplay
      session={data.session}
      steps={data.steps}
      activeRoundId={search.round}
      connected={stream.connected}
      onSelectRound={(round) => navigate({ search: { round }, replace: true })}
    />
  )
}
```

### Step 3: Delete obsolete files

```bash
git rm -r apps/web/src/features/session-replay/renderers
git rm apps/web/src/features/session-replay/detail/StepDetail.tsx
git rm apps/web/src/features/session-replay/detail/StepMetaHeader.tsx
git rm apps/web/src/features/session-replay/detail/EventsTab.tsx
git rm apps/web/src/features/session-replay/detail/RawTab.tsx
git rm apps/web/src/features/session-replay/timeline/StepRow.tsx
git rm apps/web/src/features/session-replay/timeline/StepTimeline.tsx
git rm apps/web/src/features/session-replay/timeline/step-icons.ts
```

### Step 4: Update `CLAUDE.md`

The section currently says:

```markdown
- **Adding a step renderer (M2+).** Each step type has a `StepRenderer` in `apps/web/src/features/session-replay/renderers/`. To add one:
  ...
```

Replace that bullet with:

```markdown
- **Round-based replay UI (post-M3).** The session detail page is structured around `Round` objects derived by `computeRounds(steps)` in `apps/web/src/features/session-replay/lib/compute-rounds.ts`. Each row = one LLM call. The right panel composes 5 sections (Context / Trigger / LLM call / Tool execution / Raw) under `apps/web/src/features/session-replay/detail/sections/`. To add a new section: create a `*Section.tsx` under `sections/`, then add it to `RoundDetail.tsx`'s composition (collapsible if context/raw-like, plain `<section>` if always-open).
```

### Step 5: Run all checks

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web lint
pnpm --filter @argus/web test
pnpm --filter @argus/web build
```

All exit 0. Web tests should be **14** (7 step-helpers + 7 computeRounds — the old 10 registry tests are gone).

### Step 6: Commit

```bash
git add apps/web/src/features/session-replay/index.tsx \
        apps/web/src/routes/sessions/\$sessionId.tsx \
        CLAUDE.md
git commit -m "feat(web): round-based session replay (delete per-step renderers)"
```

(`git rm` from Step 3 already staged the deletions; they'll be part of this commit.)

---

## Task 8: M3.5 end-to-end acceptance + tag

No new code. Verification + tagging.

- [ ] **Step 1: Clean install + full pipeline**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm db:up
sleep 5
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:down
```

All exit 0. Expected test counts:

- Server: 31 (unchanged from M3)
- Web: 14 (7 step-helpers + 7 computeRounds)

- [ ] **Step 2: Live browser smoke (manual, recommend user run this in a browser)**

```bash
pnpm db:up
sleep 5
pnpm db:migrate
pnpm db:seed

DATABASE_URL=postgres://argus:argus@localhost:5432/argus pnpm dev > /tmp/argus.log 2>&1 &
DEV_PID=$!
sleep 8

echo "--- /api/sessions ---"
curl -sf http://localhost:4000/api/sessions | python3 -m json.tool

SESSION_ID=$(curl -sf http://localhost:4000/api/sessions | python3 -c 'import sys, json; print(json.load(sys.stdin)["sessions"][0]["id"])')
echo "Session id: $SESSION_ID"

echo "--- /api/sessions/<id> ---"
curl -sf http://localhost:4000/api/sessions/$SESSION_ID | python3 -m json.tool | head -100

kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null || true
pnpm db:down
```

Manual browser verification (by the user; subagent reports the curl outputs and leaves browser checks for the user):

1. Open `http://localhost:5173`
2. Click into the demo session
3. Left timeline shows **2 rounds** (was 6 step rows before this rework):
   - Row 1: 👤 **User** · "今天合肥天气怎么样" · ~1.2s
   - Row 2: 🔧 **Tool result · get_weather** · `{"temperature":30,"condition":"Sunny"}` · ~2.3s
4. Click Row 1. Right panel shows:
   - Header: `Round 1 / 2`, badge `OK`, model `claude-3-7-sonnet`, tokens `120/45`, `1 tool exec`
   - `📋 Context` (collapsed) — click to expand: shows system prompt, the get_weather tool schema, 2-message history (system + user)
   - `⚡ Trigger` — blue speech bubble with the user message
   - `🧠 LLM call` — shows tool_calls (get_weather with Hefei), stop: tool_use
   - `🔧 Tool execution` — get_weather card with input {city: Hefei} and green output {temperature: 30, ...}
   - `🗂️ Raw` (collapsed)
5. Click Row 2. Right panel updates to Round 2:
   - Header: `Round 2 / 2`, tokens `180/30`, no tool exec
   - Context expands to show 4-message history (system, user, assistant tool_call, tool result)
   - Trigger section shows the tool result green box
   - LLM call section shows the final assistant text "合肥今天天气晴朗，气温 30°C。"
6. URL has `?round=<uuid>` and reload restores the same round.

- [ ] **Step 3: Tag + push**

```bash
git tag -a round-timeline-rework -m "Round-based timeline rework complete

Replaces per-span timeline with per-round (one LLM call = one row).
Each row's label is the trigger type (User / Tool result).
Detail panel composes 5 sections (Context / Trigger / LLM call / Tool execution / Raw).
Seed updated to realistic 2-LLM-call pattern.

Acceptance:
- pnpm install/typecheck/lint/test/build all green (31 server + 14 web tests)
- Demo session shows 2 rounds in timeline
- All 5 detail sections render correctly for seed data
- URL ?round=<id> + reload restores selection
- Old per-step renderers + StepDetail deleted (no longer needed)
"
git push origin main
git push origin round-timeline-rework
```

- [ ] **Step 4: Confirm CI is green** at https://github.com/tiven-ai/Argus/actions.

---

## Acceptance summary

Complete when:

- [ ] `pnpm install` clean
- [ ] `pnpm typecheck` / `lint` / `test` / `build` all exit 0
- [ ] Server tests: 31 pass (unchanged from M3)
- [ ] Web tests: 14 pass (7 step-helpers + 7 computeRounds)
- [ ] Old per-step renderers + StepDetail / StepRow / StepTimeline / EventsTab / RawTab / StepMetaHeader / step-icons.ts deleted
- [ ] Seed produces 2 rounds (demo: user round + tool result round)
- [ ] Browser shows 2-row timeline + 5-section RoundDetail; clicking each row updates URL and right panel
- [ ] Tag `round-timeline-rework` pushed; CI green
