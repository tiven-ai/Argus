# Sending traces to Argus

> **Audience:** an engineer wiring an AI-agent application up to Argus for the first time.
> **Goal:** from zero to seeing your own session render in the UI, in about 10 minutes.

Argus ingests standard **OpenTelemetry** traces. If your app already exports OTel spans, you point the exporter at Argus and add a few `argus.*` attributes so each span renders as the right kind of step. If it doesn't, any OTLP-capable exporter or the OpenTelemetry Collector works.

This page is the **task walkthrough**. The exact attribute contract (every key, every accepted value) lives in [`../conventions/semantic-conventions.md`](../conventions/semantic-conventions.md) — that reference is the source of truth; this guide only shows the minimum needed to get data flowing.

---

## At a glance

|                     |                                                                      |
| ------------------- | -------------------------------------------------------------------- |
| **Endpoint (HTTP)** | `POST /v1/traces` — OTLP/HTTP-JSON, `Content-Type: application/json` |
| **Endpoint (gRPC)** | standard OTLP/gRPC `TraceService/Export`                             |
| **Default ports**   | HTTP `4000`, gRPC `4317` (dev)                                       |
| **Auth**            | `Authorization: Bearer argus_…` (required in multi-tenant mode)      |
| **Body**            | standard OTLP `ExportTraceServiceRequest`                            |
| **Success**         | `200 OK` → `{ "accepted": <span-count> }`                            |

---

## Step 1 — Get an ingest token

A token authenticates ingestion and determines **which project** your traces land in. One token owns exactly one project.

**In the UI:** sign in → **Settings → Tokens → Create a new token**. Give it a project name (auto-created on first use) and a token name. The full token is shown **once** — copy it now; only a `argus_…`-prefixed display stub is kept afterwards.

A token looks like:

```
argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
```

> **Local mode.** If the server runs with `ARGUS_MODE=local` (the single-tenant default for local dev), ingestion requires **no token** — every trace lands under the built-in `default` org. The steps below still work; just omit the `Authorization` header. A token is mandatory only in `multi-tenant` mode.

---

## Step 2 — Point your exporter at Argus

Configure your OpenTelemetry **trace** exporter (OTLP) with the Argus endpoint and your token.

**OTLP/HTTP** (recommended — simplest, matches the curl below):

```
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = http://localhost:4000/v1/traces
OTEL_EXPORTER_OTLP_TRACES_HEADERS  = Authorization=Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = http/json
```

**OTLP/gRPC** (if you prefer gRPC):

```
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = http://localhost:4317
OTEL_EXPORTER_OTLP_TRACES_HEADERS  = Authorization=Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845
```

> Some gRPC clients (e.g. browser gRPC-Web) can't set `Authorization` metadata. Argus also accepts the token in an `x-argus-token: argus_…` metadata key as a fallback.

Replace `localhost` and the ports with your deployment's host. Argus speaks vanilla OTLP, so the OpenTelemetry Collector's `otlphttp` / `otlp` exporters work too — route a pipeline at the endpoint above.

---

## Step 3 — Send a trace

The fastest way to confirm the pipe works is the bundled example payload:

```bash
curl -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer argus_3f8a1c9e0b7d4256ae91f0c3d2b6e845' \
  --data-binary @scripts/example-trace.json
```

Expected response:

```json
{ "accepted": 6 }
```

(`scripts/example-trace.json` is a minimal one-session payload — a good template for the shape Argus expects. In local mode, drop the `Authorization` header.)

---

## Step 4 — Annotate spans so they render well

Argus accepts any OTel trace, but the **session replay** view is built around a few `argus.*` attributes. Set these and a raw span becomes a labelled, grouped step.

### Resource attributes (once per export, on the `resource`)

| Attribute       | Required          | Purpose                                                                |
| --------------- | ----------------- | ---------------------------------------------------------------------- |
| `argus.project` | **yes**           | Which project the session belongs to. Auto-created on first use.       |
| `argus.service` | yes (or fallback) | The emitting service. Falls back to standard `service.name` if absent. |

### Span attributes (per span)

| Attribute              | Drives                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `argus.step.kind`      | The step's icon/label and how it's grouped into a round.        |
| `argus.component.type` | The detail renderer and **Execution-tab grouping** (see below). |
| `argus.component.name` | The concrete tool / skill / model name shown to users.          |

Recognized values and the full key list are in [`semantic-conventions.md`](../conventions/semantic-conventions.md#span-attributes--argus-extensions). The short version:

- `argus.step.kind` ∈ `user_message`, `assistant_message`, `system_prompt`, `llm_call`, `tool_call`, `external_resource`
- `argus.component.type` ∈ `llm`, `skill`, `mcp`, `middleware`, `custom_tool`, `external_resource`

### Payloads go in span **events**, not attributes

Large content (prompts, messages, tool I/O, errors) belongs in named span events, not attributes (attributes have a per-key size cap):

| Event          | Carries (common keys)                                     |
| -------------- | --------------------------------------------------------- |
| `argus.input`  | `text`, `messages`, `tools`, `system_prompt`, `arguments` |
| `argus.output` | `text`, `tool_calls`, `stop_reason`                       |
| `argus.error`  | `type`, `message`, `stack` (set when span status = ERROR) |

### Getting the "Execution" tab to group correctly

The step-detail **Execution** tab shows the calls a round made, in two levels:

- A span is **"External resource"** when `argus.component.type` is `external_resource` or `mcp`. Within that, it's sub-categorized into **Knowledge base / Memory / Database / HTTP / Other** by a keyword match on `argus.component.name` (e.g. a name containing `search`/`vector`/`rag` → Knowledge base; `sql`/`postgres`/`query` → Database; `http`/`api`/`fetch` → HTTP; `memory`/`recall` → Memory).
- Everything else (`custom_tool`, `skill`, `middleware`, or unset) is **"Internal logic"**.

So: emit `argus.component.type = external_resource` (or `mcp`) with a descriptive `argus.component.name` for calls that leave your process, and they'll bucket into the right resource category. Calls with `argus.step.kind` of `tool_call` or `external_resource` are the ones that appear in the Execution tab for their round.

---

## Step 5 — Verify

Open the Argus UI (dev: <http://localhost:5173>) and go to **Sessions**. Your session appears at the top of the list within a couple of seconds (the list and the detail view stream live). Click in to see the round-by-round replay; switch the **Execution** tab to confirm your external-resource calls grouped as expected.

---

## Identifier & time formats

These follow the OTLP spec; most SDKs handle them for you, but if you're hand-building payloads:

- **`traceId` / `spanId`** — lowercase hex (32 / 16 chars) **or** base64. Argus normalizes to lowercase hex.
- **`startTimeUnixNano` / `endTimeUnixNano`** — decimal **strings** of int64 nanoseconds since the epoch. Normalized to millisecond-resolution UTC internally.

---

## Troubleshooting

| Symptom                                                    | Likely cause                                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 { "error": "unauthenticated" }`                       | Multi-tenant mode with a missing/invalid token. Check the `Authorization: Bearer argus_…` header.                                                               |
| `400 { "error": "invalid_otlp_payload", "issues": [...] }` | Body isn't valid OTLP, or a required attribute is missing (e.g. `argus.project`). The `issues` array names the problem.                                         |
| `200 { "accepted": N }` but nothing in the UI              | Wrong project (check the token's project), or no `llm_call` span — the replay groups around LLM calls, so a session with zero `llm_call` spans shows no rounds. |
| Span shows as raw JSON, no nice label                      | Missing `argus.step.kind` / `argus.component.type` on that span.                                                                                                |
| External call landed under "Internal logic"                | Its `argus.component.type` isn't `external_resource`/`mcp`, or `argus.component.name` didn't match a resource keyword.                                          |

---

## Reference

- [`semantic-conventions.md`](../conventions/semantic-conventions.md) — the complete attribute contract (source of truth).
- [`scripts/example-trace.json`](../../scripts/example-trace.json) — a minimal, copy-able payload.
- [`../api/README.md`](../api/README.md) — the rest of the HTTP API (sessions, tokens, auth).
