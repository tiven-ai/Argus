# Argus — AI Collaborator Notes

This file is read by Claude Code (and other AI assistants) when working on this repo.

## What this project is

Argus is an observability system for AI agent programs. It accepts OpenTelemetry traces and renders an agent session as a step-by-step replay (left pane: ordered steps; right pane: structured detail per step). Single-session debugging is the MVP value; production monitoring and product analytics are future extensions.

The high-level design lives in `docs/superpowers/specs/2026-05-28-argus-design.md` — start there.

## Source of truth, by topic

| Question                        | Read this                                                             |
| ------------------------------- | --------------------------------------------------------------------- |
| Why was X built this way?       | `docs/adr/`                                                           |
| What's the next thing to build? | `docs/superpowers/plans/` (latest dated file in the active milestone) |
| What does the data look like?   | `docs/conventions/semantic-conventions.md`                            |
| How do I run it?                | `README.md`                                                           |
| Project conventions             | `docs/conventions/`                                                   |
| UI design system / tokens       | `docs/design/DESIGN.md`                                               |

## Working rules

- All new features go through `brainstorming → writing-plans → executing-plans` skills. Don't skip ahead to code.
- Every PR is a small step. Frequent commits. TDD where the unit is testable.
- Don't introduce a new external service (Redis, Kafka, ClickHouse, etc.) without an ADR.
- Keep modules small and focused. Module ↔ module communication only through `index.ts`.
- Strict TypeScript everywhere. No `any` without a `// reason:` comment.
- Never use `git commit --no-verify` or `--no-gpg-sign` unless explicitly asked.
- **Round-based replay UI (post-M3).** The session detail page is structured around `Round` objects derived by `computeRounds(steps)` in `apps/web/src/features/session-replay/lib/compute-rounds.ts`. Each row = one LLM call. The right panel composes 5 sections (Context / Trigger / LLM call / Tool execution / Raw) under `apps/web/src/features/session-replay/detail/sections/`. To add a new section: create a `*Section.tsx` under `sections/`, then add it to `RoundDetail.tsx`'s composition (collapsible if context/raw-like, plain `<section>` if always-open).
- **Adding a new tenant-data table:** (1) include `org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE`, (2) `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY`, (3) `CREATE POLICY tenant_isolation … USING/WITH CHECK (org_id = current_setting('argus.current_org_id', true)::uuid)`, (4) `GRANT SELECT, INSERT, UPDATE, DELETE … TO argus_app`, (5) tests for that table wrap in `withTenantTx`.
- **Adding a new audit event:** add the literal to `AuditEventType` in `apps/server/src/modules/audit/types.ts`, call `audit.record(trx, { eventType: 'new_event_type', ... })` at the relevant code path, write an integration test that asserts the row lands.

## Repo orientation

- Backend: `apps/server` — Fastify + Kysely + Postgres
- Frontend: `apps/web` — Vite + React 19 + Tailwind v4 + shadcn/ui + TanStack Router/Query
- Shared TypeScript types and Zod schemas: `packages/shared-types`
- Lint/tsconfig presets: `packages/eslint-config` and `packages/tsconfig`

## Common pitfalls

- **Don't add to `attributes` what belongs in a Span Event** — see `docs/conventions/semantic-conventions.md`.
- **All queries against tenant data tables (`projects`, `sessions`, `steps`, `step_events`, `audit_log`) MUST run inside `app.withTenantTx(orgId, trx => ...)`.** RLS is enforced at the DB layer; without the wrapper, SELECTs return 0 rows and INSERT/UPDATE violate `WITH CHECK`. Application-layer `WHERE org_id = ?` clauses are retained for index efficiency + defense in depth.
- **Don't add UI strings without translating** to en/zh-CN/ja once i18n lands in M6.
- **Use Span Events for structured payloads, not large attributes.** `argus.input` / `argus.output` / `argus.error` events carry the data. Attributes are for IDs, names, classifications, and small scalars.
