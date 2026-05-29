import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const sch = tool as ToolSchema
  const params = sch.parameters?.properties ?? {}
  const required = new Set(sch.parameters?.required ?? [])
  const hasParams = Object.keys(params).length > 0
  return (
    <div className="border border-hairline rounded p-2 space-y-2">
      <div className="flex items-baseline gap-2">
        <Wrench className="h-3.5 w-3.5 text-text-3 shrink-0" strokeWidth={1.75} />
        <span className="font-mono u-h-md text-text-1">{sch.name ?? t('tool.unnamed')}</span>
      </div>
      {sch.description && <p className="u-caption text-text-3">{sch.description}</p>}
      {hasParams && (
        <div>
          <p className="u-caption text-text-3 mb-1">{t('tool.parameters')}</p>
          <ul className="u-caption space-y-0.5">
            {Object.entries(params).map(([key, prop]) => (
              <li key={key}>
                <span className="font-mono text-text-2">{key}</span>{' '}
                <span className="text-text-3">
                  ({prop?.type ?? 'any'}
                  {required.has(key) ? `, ${t('tool.required')}` : ''})
                </span>
                {prop?.description && <span className="text-text-3"> — {prop.description}</span>}
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
        return <ToolCallCard key={obj.id ?? i} call={obj} />
      })}
    </ul>
  )
}

function ToolCallCard({ call }: { call: ToolCall }) {
  const { t } = useTranslation()
  return (
    <li className="border border-hairline rounded p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Wrench className="h-3.5 w-3.5 text-text-3 shrink-0" strokeWidth={1.75} />
        <span className="font-mono u-h-md text-text-1">{call.name ?? t('tool.unnamed')}</span>
        {call.id && <span className="u-caption text-text-4 font-mono ml-auto">{call.id}</span>}
      </div>
      {call.arguments !== undefined && <ToolArguments args={call.arguments} />}
    </li>
  )
}

function ToolArguments({ args }: { args: unknown }) {
  const { t } = useTranslation()
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
      return <p className="u-caption text-text-4">{t('tool.noArguments')}</p>
    }
    return (
      <div>
        <p className="u-caption text-text-3 mb-1">{t('tool.arguments')}</p>
        <table className="u-caption w-full">
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-t border-hairline">
                <td className="font-mono pr-3 py-0.5 text-text-3 align-top w-1/4">{key}</td>
                <td className="font-mono py-0.5 break-all text-text-2">
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
    <pre className="u-caption bg-tile border border-hairline p-2 rounded overflow-auto text-text-2">
      {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
    </pre>
  )
}
