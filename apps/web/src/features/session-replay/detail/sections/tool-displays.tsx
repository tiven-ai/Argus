import { Wrench } from 'lucide-react'

interface ToolSchema {
  name?: string
  description?: string
  parameters?: {
    type?: string
    properties?: Record<string, ToolProperty>
    required?: string[]
  }
}

interface ToolProperty {
  type?: string
  description?: string
}

interface ToolCall {
  id?: string
  name?: string
  arguments?: unknown
}

export function ToolDefinitionsList({ tools }: { tools: unknown[] }) {
  return (
    <ul className="space-y-2">
      {tools.map((tool, i) => {
        const key = (tool as { name?: string })?.name ?? `tool-${i}`
        return (
          <li key={key}>
            <ToolDefinitionCard tool={tool} />
          </li>
        )
      })}
    </ul>
  )
}

function ToolDefinitionCard({ tool }: { tool: unknown }) {
  const t = tool as ToolSchema
  const params = t.parameters?.properties ?? {}
  const required = new Set(t.parameters?.required ?? [])
  const hasParams = Object.keys(params).length > 0
  return (
    <div className="border rounded p-3 text-sm space-y-2 bg-white">
      <div className="flex items-baseline gap-2">
        <Wrench className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
        <span className="font-mono font-medium">{t.name ?? '(unnamed)'}</span>
      </div>
      {t.description && <p className="text-xs text-neutral-600">{t.description}</p>}
      {hasParams && (
        <div>
          <p className="text-xs uppercase text-neutral-500 mb-1">Parameters</p>
          <ul className="text-xs space-y-0.5">
            {Object.entries(params).map(([key, prop]) => (
              <li key={key}>
                <span className="font-mono">{key}</span>{' '}
                <span className="text-neutral-500">
                  ({prop?.type ?? 'any'}
                  {required.has(key) ? ', required' : ''})
                </span>
                {prop?.description && (
                  <span className="text-neutral-500"> — {prop.description}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ToolCallList({ toolCalls }: { toolCalls: unknown[] }) {
  return (
    <ul className="space-y-2">
      {toolCalls.map((tc, i) => {
        const obj = tc as ToolCall
        return (
          <li key={obj.id ?? i} className="border rounded p-2 text-sm space-y-1.5 bg-white">
            <div className="flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-neutral-500 shrink-0" />
              <span className="font-mono font-medium">{obj.name ?? '(unnamed)'}</span>
              {obj.id && (
                <span className="text-xs text-neutral-400 font-mono ml-auto">{obj.id}</span>
              )}
            </div>
            {obj.arguments !== undefined && <ToolArguments args={obj.arguments} />}
          </li>
        )
      })}
    </ul>
  )
}

function ToolArguments({ args }: { args: unknown }) {
  // Some providers stringify JSON before passing it as `arguments`. Try parse.
  let parsed: unknown = args
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args)
    } catch {
      // leave as raw string
    }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>)
    if (entries.length === 0) {
      return <p className="text-xs text-neutral-400">(no arguments)</p>
    }
    return (
      <div>
        <p className="text-xs uppercase text-neutral-500 mb-1">Arguments</p>
        <table className="text-xs w-full">
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-t">
                <td className="font-mono pr-3 py-0.5 text-neutral-600 align-top w-1/4">{key}</td>
                <td className="font-mono py-0.5 break-all">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
      {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
    </pre>
  )
}
