import type { Step } from '@argus/shared-types'

export type ExecutionCategory = 'internal' | 'knowledge' | 'memory' | 'database' | 'http' | 'other'

export interface ExecutionGroup {
  category: ExecutionCategory
  steps: Step[]
}

// 第一级：靠 component.type 区分"调用外部资源" vs "程序内部逻辑"。
const EXTERNAL_TYPES = new Set(['external_resource', 'mcp'])

// 第二级（仅外部资源）：靠名称子串启发式归类。顺序匹配，命中即止。
const EXTERNAL_KEYWORDS: Array<[Exclude<ExecutionCategory, 'internal' | 'other'>, string[]]> = [
  ['knowledge', ['knowledge', 'kb', 'retriev', 'vector', 'embed', 'rag', 'search']],
  ['memory', ['memory', 'recall', 'mem0']],
  ['database', ['db', 'sql', 'database', 'query', 'postgres', 'mysql', 'mongo', 'redis']],
  ['http', ['http', 'api', 'fetch', 'request', 'url', 'rest', 'webhook']],
]

// 渲染顺序：internal 在前，外部资源类目按固定顺序，other 兜底最后。
const ORDER: ExecutionCategory[] = ['internal', 'knowledge', 'memory', 'database', 'http', 'other']

function categoryFor(step: Step): ExecutionCategory {
  if (!EXTERNAL_TYPES.has(step.componentType ?? '')) return 'internal'
  const label = (step.componentName ?? step.name).toLowerCase()
  for (const [category, keywords] of EXTERNAL_KEYWORDS) {
    if (keywords.some((kw) => label.includes(kw))) return category
  }
  return 'other'
}

export function classifyExecutions(steps: Step[]): ExecutionGroup[] {
  const buckets = new Map<ExecutionCategory, Step[]>()
  for (const step of steps) {
    const category = categoryFor(step)
    const bucket = buckets.get(category)
    if (bucket) bucket.push(step)
    else buckets.set(category, [step])
  }
  return ORDER.filter((c) => buckets.has(c)).map((category) => ({
    category,
    steps: buckets.get(category)!,
  }))
}
