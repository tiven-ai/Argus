import { z } from 'zod'

export const StepEventSchema = z.object({
  id: z.string(),
  name: z.string(),
  ts: z.string(),
  attributes: z.record(z.unknown()),
})

export const StepSchema = z.object({
  id: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().nullable(),
  name: z.string(),
  kind: z.string().nullable(),
  componentType: z.string().nullable(),
  componentName: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string(),
  attributes: z.record(z.unknown()),
  statusCode: z.string(),
  statusMessage: z.string().nullable(),
  events: z.array(StepEventSchema),
})

export const SessionSummarySchema = z.object({
  id: z.string(),
  traceId: z.string(),
  projectName: z.string(),
  serviceName: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  stepCount: z.number(),
})

export const SessionDetailSchema = SessionSummarySchema.extend({
  steps: z.array(StepSchema),
})

export const ListSessionsResponseSchema = z.object({
  sessions: z.array(SessionSummarySchema),
})

export const GetSessionResponseSchema = z.object({
  session: SessionSummarySchema,
  steps: z.array(StepSchema),
})

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const ListProjectsResponseSchema = z.object({
  projects: z.array(ProjectSummarySchema),
})

export type StepEvent = z.infer<typeof StepEventSchema>
export type Step = z.infer<typeof StepSchema>
export type SessionSummary = z.infer<typeof SessionSummarySchema>
export type SessionDetail = z.infer<typeof SessionDetailSchema>
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>
export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>
