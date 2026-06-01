# ADR-0005 — Docs-as-code with a generated portal (not a separate docs CMS)

- **Status:** Accepted
- **Date:** 2026-06-01

## Context

Argus needs customer-facing documentation (integration guides, API reference, conventions) and will eventually want a product portal to present it. The recurring failure mode for product docs is drift: a fact — an endpoint shape, an attribute's accepted values, a token format — gets written in both the code and a separately-maintained docs site, and the two diverge. We already saw a small instance of this (an example payload's span count documented as 7 when the file had 6).

We need to decide where documentation source lives and how a future portal relates to it, before we accumulate pages that are expensive to reorganize.

## Decision

Documentation is **docs-as-code**: the canonical source is Markdown under `docs/` in this repository, versioned and reviewed in the same pull requests as the code it describes. A future product portal is a **view layer** that renders these files (via a static-site generator such as Docusaurus / VitePress / Astro Starlight) — not a separate content store with its own copy of the truth.

Supporting rules (documented in [`docs/README.md`](../README.md)):

- Docs are organized by reader intent ([Diátaxis](https://diataxis.fr/): tutorials, how-to, reference, explanation), not by feature.
- Each contract has a single source of truth; other pages link to it rather than copying. Machine-generable references (HTTP API → OpenAPI from Zod schemas; the `argus.*` attribute contract) are generated or hand-maintained in exactly one place.
- A behavior-changing PR updates the affected doc in the same PR.
- English is the one canonical source language; localization happens at the portal layer.

## Consequences

- ✅ Docs and code stay in sync because they move together and are reviewed together.
- ✅ No second system to maintain; the portal is disposable/replaceable because the truth is the Markdown.
- ✅ PR previews and release tagging come for free from the same git workflow.
- ✅ Single-source-of-truth + generation lets CI catch drift (dead links, stale examples, enum mismatches).
- ⚠️ Requires discipline: reviewers must enforce "docs in the same PR." Tooling (link checks, example smoke tests) should back this up rather than relying on memory.
- ⚠️ The portal generator is a deferred choice; until it's built, docs are consumed as Markdown in the repo. Picking the generator is a smaller, reversible follow-up.

## Alternatives Considered

- **A standalone docs CMS / hosted docs product** (e.g. a SaaS knowledge base): nice editing UX, but it becomes a second source of truth that drifts from the code and can't be reviewed alongside PRs.
- **Wiki (e.g. GitHub Wiki / Confluence):** low friction to start, but lives outside the repo, isn't versioned with the code, and has no PR-review gate — the exact drift we're trying to avoid.
- **Generate everything from code, no prose:** works for reference (OpenAPI) but can't express tutorials, how-tos, or rationale. We keep generation for reference material and hand-write the narrative buckets.
