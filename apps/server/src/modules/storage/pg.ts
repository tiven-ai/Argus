import type { Kysely, Transaction } from 'kysely'
import type { DB } from '../../db/schema.js'
import type {
  NewStep,
  StorageBackend,
  StoredSessionDetail,
  StoredSessionSummary,
  StoredStep,
  StoredStepEvent,
  WriteTraceInput,
  WriteTraceResult,
} from './types.js'

export class PgStorage implements StorageBackend {
  constructor(private readonly db: Kysely<DB>) {}

  async writeTrace(input: WriteTraceInput): Promise<WriteTraceResult> {
    const insertedSpanIds: string[] = []

    const sessionId = await this.db.transaction().execute(async (trx) => {
      const projectId = await this.upsertProject(trx, input.orgId, input.projectName)
      const serviceId = await this.upsertService(trx, projectId, input.serviceName)
      const sessionId = await this.upsertSession(
        trx,
        serviceId,
        input.traceId,
        input.sessionStartedAt,
        input.sessionEndedAt,
      )

      for (const step of input.steps) {
        const stepId = await this.upsertStep(trx, sessionId, step)
        if (step.events.length > 0) {
          await trx.deleteFrom('step_events').where('step_id', '=', stepId).execute()
          await trx
            .insertInto('step_events')
            .values(
              step.events.map((e) => ({
                step_id: stepId,
                name: e.name,
                ts: e.ts,
                attributes: JSON.stringify(e.attributes),
              })),
            )
            .execute()
        }
        insertedSpanIds.push(step.spanId)
      }

      const { count } = await trx
        .selectFrom('steps')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('session_id', '=', sessionId)
        .executeTakeFirstOrThrow()
      await trx
        .updateTable('sessions')
        .set({ step_count: Number(count) })
        .where('id', '=', sessionId)
        .execute()

      return sessionId
    })

    // After commit, read back the written steps in input order, with their events.
    const detail = await this.getSession({ orgId: input.orgId, sessionId })
    const writtenSteps: StoredStep[] =
      detail?.steps.filter((s) => insertedSpanIds.includes(s.spanId)) ?? []

    return { sessionId, writtenSteps }
  }

  async listSessions(opts: { orgId: string; limit?: number }): Promise<StoredSessionSummary[]> {
    const limit = opts.limit ?? 50
    const rows = await this.db
      .selectFrom('sessions as ses')
      .innerJoin('services as svc', 'svc.id', 'ses.service_id')
      .innerJoin('projects as prj', 'prj.id', 'svc.project_id')
      .where('prj.org_id', '=', opts.orgId)
      .select([
        'ses.id as id',
        'ses.trace_id as traceId',
        'prj.name as projectName',
        'svc.name as serviceName',
        'ses.started_at as startedAt',
        'ses.ended_at as endedAt',
        'ses.step_count as stepCount',
      ])
      .orderBy('ses.started_at', 'desc')
      .limit(limit)
      .execute()

    return rows.map((r) => ({
      ...r,
      startedAt: new Date(r.startedAt as unknown as string),
      endedAt: r.endedAt ? new Date(r.endedAt as unknown as string) : null,
    }))
  }

  async getSession(opts: {
    orgId: string
    sessionId: string
  }): Promise<StoredSessionDetail | null> {
    const summaryRow = await this.db
      .selectFrom('sessions as ses')
      .innerJoin('services as svc', 'svc.id', 'ses.service_id')
      .innerJoin('projects as prj', 'prj.id', 'svc.project_id')
      .where('ses.id', '=', opts.sessionId)
      .where('prj.org_id', '=', opts.orgId)
      .select([
        'ses.id as id',
        'ses.trace_id as traceId',
        'prj.name as projectName',
        'svc.name as serviceName',
        'ses.started_at as startedAt',
        'ses.ended_at as endedAt',
        'ses.step_count as stepCount',
      ])
      .executeTakeFirst()

    if (!summaryRow) return null

    const stepRows = await this.db
      .selectFrom('steps')
      .where('session_id', '=', opts.sessionId)
      .selectAll()
      .orderBy('started_at', 'asc')
      .execute()

    const eventRows =
      stepRows.length === 0
        ? []
        : await this.db
            .selectFrom('step_events')
            .where(
              'step_id',
              'in',
              stepRows.map((s) => s.id),
            )
            .selectAll()
            .orderBy('ts', 'asc')
            .execute()

    const eventsByStep = new Map<string, StoredStepEvent[]>()
    for (const e of eventRows) {
      const arr = eventsByStep.get(e.step_id) ?? []
      arr.push({
        id: e.id,
        name: e.name,
        ts: new Date(e.ts as unknown as string),
        attributes: (e.attributes ?? {}) as Record<string, unknown>,
      })
      eventsByStep.set(e.step_id, arr)
    }

    const steps: StoredStep[] = stepRows.map((s) => ({
      id: s.id,
      spanId: s.span_id,
      parentSpanId: s.parent_span_id,
      name: s.name,
      kind: s.kind,
      componentType: s.component_type,
      componentName: s.component_name,
      startedAt: new Date(s.started_at as unknown as string),
      endedAt: new Date(s.ended_at as unknown as string),
      attributes: (s.attributes ?? {}) as Record<string, unknown>,
      statusCode: s.status_code,
      statusMessage: s.status_message,
      events: eventsByStep.get(s.id) ?? [],
    }))

    return {
      id: summaryRow.id,
      traceId: summaryRow.traceId,
      projectName: summaryRow.projectName,
      serviceName: summaryRow.serviceName,
      startedAt: new Date(summaryRow.startedAt as unknown as string),
      endedAt: summaryRow.endedAt ? new Date(summaryRow.endedAt as unknown as string) : null,
      stepCount: summaryRow.stepCount,
      steps,
    }
  }

  private async upsertProject(trx: Transaction<DB>, orgId: string, name: string): Promise<string> {
    const existing = await trx
      .selectFrom('projects')
      .where('org_id', '=', orgId)
      .where('name', '=', name)
      .select('id')
      .executeTakeFirst()
    if (existing) return existing.id

    const inserted = await trx
      .insertInto('projects')
      .values({ org_id: orgId, name })
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }

  private async upsertService(
    trx: Transaction<DB>,
    projectId: string,
    name: string,
  ): Promise<string> {
    const existing = await trx
      .selectFrom('services')
      .where('project_id', '=', projectId)
      .where('name', '=', name)
      .select('id')
      .executeTakeFirst()
    if (existing) return existing.id

    const inserted = await trx
      .insertInto('services')
      .values({ project_id: projectId, name })
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }

  private async upsertSession(
    trx: Transaction<DB>,
    serviceId: string,
    traceId: string,
    startedAt: Date,
    endedAt: Date | null,
  ): Promise<string> {
    const existing = await trx
      .selectFrom('sessions')
      .where('service_id', '=', serviceId)
      .where('trace_id', '=', traceId)
      .select(['id', 'started_at as startedAt', 'ended_at as endedAt'])
      .executeTakeFirst()

    if (existing) {
      const newStart =
        startedAt < new Date(existing.startedAt as unknown as string)
          ? startedAt
          : new Date(existing.startedAt as unknown as string)
      const newEnd =
        endedAt && (!existing.endedAt || endedAt > new Date(existing.endedAt as unknown as string))
          ? endedAt
          : existing.endedAt
            ? new Date(existing.endedAt as unknown as string)
            : null
      await trx
        .updateTable('sessions')
        .set({ started_at: newStart, ended_at: newEnd })
        .where('id', '=', existing.id)
        .execute()
      return existing.id
    }

    const inserted = await trx
      .insertInto('sessions')
      .values({
        service_id: serviceId,
        trace_id: traceId,
        started_at: startedAt,
        ended_at: endedAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }

  private async upsertStep(
    trx: Transaction<DB>,
    sessionId: string,
    step: NewStep,
  ): Promise<string> {
    const existing = await trx
      .selectFrom('steps')
      .where('session_id', '=', sessionId)
      .where('span_id', '=', step.spanId)
      .select('id')
      .executeTakeFirst()

    const values = {
      session_id: sessionId,
      span_id: step.spanId,
      parent_span_id: step.parentSpanId,
      name: step.name,
      kind: step.kind,
      component_type: step.componentType,
      component_name: step.componentName,
      started_at: step.startedAt,
      ended_at: step.endedAt,
      attributes: JSON.stringify(step.attributes),
      status_code: step.statusCode,
      status_message: step.statusMessage,
    }

    if (existing) {
      await trx.updateTable('steps').set(values).where('id', '=', existing.id).execute()
      return existing.id
    }

    const inserted = await trx
      .insertInto('steps')
      .values(values)
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }
}
