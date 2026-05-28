# ADR-0003 — Use Kysely (not Prisma) for the data-access layer

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

The Node ecosystem's two leading typed data-access tools are Prisma (ORM with a custom schema language) and Kysely (typed SQL query builder).

## Decision

Use Kysely + `kysely-codegen` (types from the live DB schema) + `kysely-migrator` (or `node-pg-migrate`) for migrations.

## Consequences

- ✅ Typed SQL we write by hand — no hidden N+1, no query-builder mystery.
- ✅ Generated types from real schema mean a `migration → codegen → compile` loop catches drift in CI.
- ✅ Lightweight; no separate engine process or schema language to learn.
- ⚠️ Migration tooling is less polished than Prisma's; we pick a separate migrator and own the integration.
- ⚠️ Some advanced ergonomics (relations, includes) are more boilerplate than Prisma's.

## Alternatives Considered

- **Prisma**: nice DX but the Prisma engine adds a separate binary, Prisma Schema is a language we'd rather not maintain, and JSONB ergonomics are weaker than raw SQL.
- **Drizzle**: close call. Kysely picked for stricter typing and more idiomatic SQL.
- **Raw `pg`**: too much repetition for a project with dozens of tables.
