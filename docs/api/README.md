# Argus HTTP API

The full OpenAPI spec is generated from Zod schemas in `apps/server` and published to `openapi.yaml` in this folder by CI.

The SSE protocol for `/api/sessions/:id/stream` is documented in `sse-protocol.md` once the live session feature ships (M3).

For the high-level shape of the API, see the design spec:
[`docs/superpowers/specs/2026-05-28-argus-design.md`](../superpowers/specs/2026-05-28-argus-design.md).
