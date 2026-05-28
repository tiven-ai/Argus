# ADR-0004 — Use Fastify (not NestJS) for the backend

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

The Argus server handles two distinct workloads: OTLP ingest (high-throughput, schema-validated) and a REST + SSE query API. We compared Fastify (lightweight plugin model) and NestJS (Spring-style framework with DI/decorators).

## Decision

Use Fastify v5 directly. Organize the codebase by module folders (`ingest/`, `storage/`, `pubsub/`, `api/`, `auth/`), wiring dependencies explicitly in module factories.

## Consequences

- ✅ Highest-throughput Node web framework — matters for OTLP ingest path.
- ✅ Built-in JSON Schema validation via Ajv; pairs well with Zod for type-shared validation.
- ✅ Less framework boilerplate; faster startup, faster tests, smaller mental model.
- ⚠️ No built-in DI container — we wire dependencies by hand. Acceptable given the project's size.
- ⚠️ Less framework-imposed structure means we enforce conventions via code review and lint.

## Alternatives Considered

- **NestJS**: strong structure, large ecosystem. Rejected because the DI/decorator overhead is more burden than benefit at our size, and the default Express engine is significantly slower than Fastify (the Fastify adapter exists but adds a configuration layer).
- **Express**: too minimal — no built-in validation, no schema-first ergonomics.
- **Hono / Elysia**: modern and fast but with smaller plugin ecosystems for OTel and observability tooling.
