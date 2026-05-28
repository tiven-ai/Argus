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

## Working rules

- All new features go through `brainstorming → writing-plans → executing-plans` skills. Don't skip ahead to code.
- Every PR is a small step. Frequent commits. TDD where the unit is testable.
- Don't introduce a new external service (Redis, Kafka, ClickHouse, etc.) without an ADR.
- Keep modules small and focused. Module ↔ module communication only through `index.ts`.
- Strict TypeScript everywhere. No `any` without a `// reason:` comment.
- Never use `git commit --no-verify` or `--no-gpg-sign` unless explicitly asked.

## Repo orientation

- Backend: `apps/server` — Fastify + Kysely + Postgres
- Frontend: `apps/web` — Vite + React 19 + Tailwind v4 + shadcn/ui + TanStack Router/Query
- Shared TypeScript types and Zod schemas: `packages/shared-types`
- Lint/tsconfig presets: `packages/eslint-config` and `packages/tsconfig`

## Common pitfalls

- **Don't add to `attributes` what belongs in a Span Event** — see `docs/conventions/semantic-conventions.md`.
- **Don't add a Postgres query that doesn't filter by `org_id`** — multi-tenant boundary. Use the `withTenant` DAO helper once it exists.
- **Don't add UI strings without translating** to en/zh-CN/ja once i18n lands in M6.
