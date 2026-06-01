# Argus Documentation

This folder is the source of truth for everything written about Argus. It is **docs-as-code**: docs live next to the code, change in the same pull requests, and a future product portal renders from these files rather than maintaining a separate copy (see [ADR-0005](./adr/0005-docs-as-code-portal.md)).

## How docs are organized

Docs are grouped by **what the reader is trying to do**, following the [Diátaxis](https://diataxis.fr/) model. When you add a page, put it in the bucket that matches its intent — don't mix a tutorial with reference material.

| Bucket                      | Reader's question                    | Where it lives                                                                                     |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Tutorials / Get started** | "Walk me through it the first time." | [`integration/`](./integration/)                                                                   |
| **How-to guides**           | "How do I accomplish task X?"        | `integration/`, `guides/` (task-specific pages)                                                    |
| **Reference**               | "What is the exact definition of X?" | [`conventions/semantic-conventions.md`](./conventions/semantic-conventions.md), [`api/`](./api/)   |
| **Explanation / Decisions** | "Why is it built this way?"          | [`architecture/`](./architecture/), [`adr/`](./adr/), [`superpowers/specs/`](./superpowers/specs/) |

### Current map

| Folder                             | Contents                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------- |
| [`integration/`](./integration/)   | Client onboarding — get a token, configure an OTel exporter, send traces. |
| [`conventions/`](./conventions/)   | The `argus.*` attribute contract, coding style, git workflow.             |
| [`api/`](./api/)                   | HTTP API reference (OpenAPI, generated) and the SSE protocol.             |
| [`architecture/`](./architecture/) | Long-form architecture (C4, module responsibilities, sequence diagrams).  |
| [`adr/`](./adr/)                   | Architecture Decision Records — decisions that are expensive to reverse.  |
| [`design/`](./design/)             | UI design system and tokens.                                              |
| [`superpowers/`](./superpowers/)   | Per-feature specs and implementation plans (the brainstorm → plan trail). |

## Maintenance rules

These keep the docs trustworthy as the system grows. The recurring failure mode is **the same fact written in two places, then one drifts** — every rule below exists to prevent that.

1. **Single source of truth per fact.** Each contract is defined in exactly one place; everything else links to it.
   - The **attribute contract** (`argus.*` keys, accepted values) → [`conventions/semantic-conventions.md`](./conventions/semantic-conventions.md). Tutorials and how-tos _link_ to it; they never re-tabulate it.
   - The **HTTP API** → generated `openapi.yaml` in [`api/`](./api/) from the Zod schemas in `packages/shared-types` / `apps/server`. Don't hand-write endpoint tables.
   - **Enums that the UI depends on** (e.g. `component.type` values, the Execution-tab grouping keywords) live in code; docs reference them by name. If you change such an enum, update the reference page in the same PR.

2. **Docs change in the PR that changes the behavior.** A feature PR that alters an endpoint, an attribute, or a user-visible flow updates the relevant doc in the same PR. Reviewers should reject "docs later."

3. **Examples must be real.** Any payload, curl, or command in a doc should be copy-pasteable and correct. Prefer pointing at a checked-in artifact (e.g. [`scripts/example-trace.json`](../scripts/example-trace.json)) over inlining a payload that can rot.

4. **One canonical language (English), translate at the portal layer.** Source docs are English. Localization (e.g. zh-CN) is a portal/i18n concern, not parallel hand-maintained markdown that drifts.

5. **Decisions go in ADRs, not in prose buried in a guide.** If you're explaining _why_ something is the way it is and it was expensive to decide, write an ADR and link to it.

## Conventions for writing a new page

- Start with audience + goal in one or two lines (see [`integration/sending-traces.md`](./integration/sending-traces.md) for the pattern).
- Link to the source-of-truth reference instead of copying its content.
- Add the page to its folder's `README.md` index so it's discoverable.
- Keep it task-focused; push "why" into an ADR or `architecture/`.
