# Argus Semantic Conventions

> **Audience:** anyone instrumenting an agent app to send OpenTelemetry traces to Argus.

Argus accepts standard OTLP/HTTP-JSON. On top of OTel's standard attributes, Argus reads a small set of `argus.*` extension attributes that control how each span is classified and rendered in the UI.

## Endpoint

```
POST /v1/traces Content-Type: application/json
```

Body: the standard OTLP `ExportTraceServiceRequest` shape encoded as JSON ([OTLP spec](https://github.com/open-telemetry/opentelemetry-proto)).

A successful request returns `200 OK` with `{ "accepted": <number-of-spans> }`. Malformed or missing required attributes return `400` with an `error` and `issues` body.

## Resource attributes

| Attribute       | Required          | Example             | Notes                                                |
| --------------- | ----------------- | ------------------- | ---------------------------------------------------- |
| `argus.project` | **yes**           | `customer-bot`      | Auto-created on first use.                           |
| `argus.service` | yes (or fallback) | `intent-classifier` | If absent, Argus falls back to `service.name`.       |
| `service.name`  | recommended       | `intent-classifier` | OTel-standard. Used as fallback for `argus.service`. |

## Span attributes — Argus extensions

| Attribute              | Values                                                                                             | Drives                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `argus.step.kind`      | `user_message`, `assistant_message`, `system_prompt`, `llm_call`, `tool_call`, `external_resource` | Left-side step list icon and label.    |
| `argus.component.type` | `llm`, `skill`, `mcp`, `middleware`, `custom_tool`, `external_resource`                            | Right-side detail renderer (lands M2). |
| `argus.component.name` | freeform string                                                                                    | Concrete tool / skill / model name.    |

Standard OTel GenAI attributes (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, etc.) are stored and exposed but not yet used to drive UI in M1.

## Span events — structured payloads

Argus reads three named span events. Use these instead of large attributes for messages, completions, and errors — attributes have a per-key size cap, events carry full structured payloads.

| Event name     | Purpose                                    | Common attribute keys                                     |
| -------------- | ------------------------------------------ | --------------------------------------------------------- |
| `argus.input`  | Input fed into this step                   | `text`, `messages`, `tools`, `system_prompt`, `arguments` |
| `argus.output` | Output produced by this step               | `text`, `tool_calls`, `stop_reason`                       |
| `argus.error`  | Error details (when `status.code = ERROR`) | `type`, `message`, `stack`                                |

## Example payload (curl)

The repo ships `scripts/example-trace.json` — a minimal one-session payload. Send it with:

```bash
curl -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json
```

Then browse to http://localhost:5173/sessions to see the resulting session.

## Identifier formats

`traceId` and `spanId` may be sent as lowercase hex (32 / 16 chars respectively) or as base64 (24 / 12 chars). Argus normalizes to lowercase hex internally.

`startTimeUnixNano` and `endTimeUnixNano` are decimal strings of int64 nanoseconds since the epoch (the OTLP-JSON spec). Argus normalizes to UTC `Date` at millisecond resolution.

## Multi-tenant note

Argus runs in single-tenant mode in M1 (`ARGUS_MODE=local`). Every accepted trace lands under the built-in `default` org. Multi-tenant auth + ingest tokens ship in M4.

## Status (M1)

This document covers what M1 implements. Items still in flight:

- Step type taxonomy is final; additions follow ADR process.
- `argus.component.type` values are recognized but UI rendering is M2.
- Inferred attributes from `gen_ai.*` (e.g. derive `argus.step.kind = llm_call` when only `gen_ai.request.model` is set) are NOT yet implemented — clients should set Argus attributes explicitly.
