# Argus Semantic Conventions (for OTel clients)

> Status: skeleton. Full attribute table will land in M1.

Clients send OpenTelemetry spans to Argus following the standard OTel GenAI Semantic Conventions plus a small set of Argus-specific extensions.

## Resource attributes (required)

| Attribute       | Type   | Required | Example             |
| --------------- | ------ | -------- | ------------------- |
| `argus.project` | string | yes      | `customer-bot`      |
| `argus.service` | string | yes      | `intent-classifier` |
| `service.name`  | string | yes      | (OTel standard)     |

## Span attributes — Argus extensions

| Attribute              | Type   | Allowed values                                                                                     | Notes                            |
| ---------------------- | ------ | -------------------------------------------------------------------------------------------------- | -------------------------------- |
| `argus.step.kind`      | string | `user_message`, `assistant_message`, `system_prompt`, `llm_call`, `tool_call`, `external_resource` | drives left-side step list icons |
| `argus.component.type` | string | `llm`, `skill`, `mcp`, `middleware`, `custom_tool`, `external_resource`                            | drives right-side renderer       |
| `argus.component.name` | string | freeform                                                                                           | concrete tool/skill name         |

## Structured payloads — Span Events

Argus reads three event names. Attribute payloads on these events carry the data the UI renders:

| Event name     | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `argus.input`  | `messages[]`, `tools[]`, `system_prompt`, params |
| `argus.output` | `text`, `tool_calls[]`, `stop_reason`            |
| `argus.error`  | error details for failed steps                   |

Span events are preferred over attributes for these payloads because they can carry large structured objects without bumping into per-attribute size limits.

> Full attribute schemas, examples, and per-language SDK guides will be added in M1.
