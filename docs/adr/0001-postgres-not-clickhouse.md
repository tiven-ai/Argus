# ADR-0001 — Use PostgreSQL (not ClickHouse) for MVP storage

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

Argus stores OpenTelemetry spans/events for AI agent observability. The two leading choices for trace backends are PostgreSQL (JSONB + partitioning) and ClickHouse (columnar, OTel-friendly).

## Decision

MVP (M0–M6) uses PostgreSQL 16+ with JSONB columns and time-based partitioning. The data layer is abstracted behind a `StorageBackend` interface so a ClickHouse implementation can be added later without rewriting business logic.

## Consequences

- ✅ Trivial local setup (one Docker container), low ops burden in private deployments.
- ✅ Rich SQL + JSONB lets us index attributes for the queries we need (by `trace_id`, by `argus.step.kind`).
- ✅ Same DB serves both metadata (orgs/projects/users) and trace data — single transactional boundary.
- ⚠️ Aggregation queries over 10M+ spans will be slow; we accept this as a tomorrow problem.
- ⚠️ When we move to SaaS scale, we will pay the cost of implementing a second `StorageBackend`.

## Alternatives Considered

- **ClickHouse**: industry-standard for OTel trace storage. Rejected for MVP because operating ClickHouse adds significant complexity (replication model, ZooKeeper / Keeper, schema migrations) for a system that won't see that data volume yet.
- **SQLite**: too limiting for the multi-tenant SaaS goal.
