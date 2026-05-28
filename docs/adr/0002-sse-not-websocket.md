# ADR-0002 — Use Server-Sent Events (not WebSocket) for live session push

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

The UI needs to stream new steps as they arrive during a live agent session. The two practical choices are SSE and WebSocket.

## Decision

Use SSE for the `/api/sessions/:id/stream` endpoint. The client opens a regular HTTP GET, and the server keeps the connection open and writes `text/event-stream` events.

## Consequences

- ✅ Pure HTTP — works through most corporate proxies and CDNs with no extra config.
- ✅ Native browser reconnection via `Last-Event-ID`.
- ✅ Easy to integrate with Fastify (no separate WS server).
- ⚠️ Strictly unidirectional. If we ever need client→server real-time messages, we'll add a separate channel.

## Alternatives Considered

- **WebSocket**: bidirectional and lower overhead per message, but we don't need bidirectionality, and proxies / load balancers handle it less consistently.
- **Long polling**: works as a fallback; we add it as a tertiary mode if SSE blocking is detected at the edge.
