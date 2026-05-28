import type { Step } from '@argus/shared-types'
import type { StepRenderer } from './types'
import { findEvent, tokenUsage } from '../lib/step-helpers'

function ModelMeta({ step }: { step: Step }) {
  const attrs = step.attributes
  const model = attrs['gen_ai.request.model'] ?? step.componentName
  const tokens = tokenUsage(step)
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-500">
      {typeof model === 'string' && <span className="font-mono">{model}</span>}
      {tokens && (
        <span>
          tokens: {tokens.input}/{tokens.output}
        </span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">{title}</h4>
      {children}
    </div>
  )
}

export const LlmCallRenderer: StepRenderer = {
  id: 'llm-call',
  match: (step) => {
    if (step.kind === 'llm_call') return 20
    if (step.componentType === 'llm') return 15
    return 0
  },
  renderInput: (step) => {
    const input = findEvent(step, 'argus.input')
    const attrs = input?.attributes ?? {}
    const messages = Array.isArray(attrs.messages) ? attrs.messages : null
    const tools = Array.isArray(attrs.tools) ? attrs.tools : null
    const systemPrompt = typeof attrs.system_prompt === 'string' ? attrs.system_prompt : null

    if (!messages && !tools && !systemPrompt) {
      return (
        <div className="space-y-4">
          <ModelMeta step={step} />
          <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
            {JSON.stringify(attrs, null, 2)}
          </pre>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <ModelMeta step={step} />
        {systemPrompt && (
          <Section title="System prompt">
            <pre className="text-sm bg-neutral-50 border p-3 rounded whitespace-pre-wrap">
              {systemPrompt}
            </pre>
          </Section>
        )}
        {messages && (
          <Section title="Messages">
            <ul className="space-y-2">
              {messages.map((m, i) => (
                <li key={i} className="border rounded p-2 text-sm">
                  <p className="text-xs text-neutral-500 mb-1">
                    {String((m as { role?: unknown }).role ?? 'unknown')}
                  </p>
                  <pre className="whitespace-pre-wrap">
                    {String((m as { content?: unknown }).content ?? '')}
                  </pre>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {tools && (
          <Section title="Tools available">
            <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
              {JSON.stringify(tools, null, 2)}
            </pre>
          </Section>
        )}
      </div>
    )
  },
  renderOutput: (step) => {
    const output = findEvent(step, 'argus.output')
    if (!output) return <p className="text-neutral-500 text-sm">(no output)</p>
    const attrs = output.attributes
    const text = typeof attrs.text === 'string' ? attrs.text : undefined
    const toolCalls = Array.isArray(attrs.tool_calls) ? attrs.tool_calls : undefined
    const stopReason = typeof attrs.stop_reason === 'string' ? attrs.stop_reason : undefined

    return (
      <div className="space-y-4">
        {text && (
          <Section title="Text">
            <pre className="text-sm bg-amber-50 border border-amber-100 p-3 rounded whitespace-pre-wrap">
              {text}
            </pre>
          </Section>
        )}
        {toolCalls && (
          <Section title="Tool calls">
            <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
              {JSON.stringify(toolCalls, null, 2)}
            </pre>
          </Section>
        )}
        {stopReason && <p className="text-xs text-neutral-500">stop: {stopReason}</p>}
        {!text && !toolCalls && (
          <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
            {JSON.stringify(attrs, null, 2)}
          </pre>
        )}
      </div>
    )
  },
}
