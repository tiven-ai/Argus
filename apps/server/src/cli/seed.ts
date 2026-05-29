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
