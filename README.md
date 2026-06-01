# Argus

> Observability for AI agents — see every step of a session: prompts, model calls, tool calls (Skill / MCP / Middleware / custom), and external resources (DB / HTTP / Redis).

Argus is named after the hundred-eyed giant in Greek mythology — built to watch everything.

## Quick start (5 minutes)

Requirements: Node 20+, pnpm 10+, Docker (for Postgres).

```bash
git clone <this-repo>
cd argus
pnpm install
pnpm db:up               # start Postgres on :5432
pnpm db:migrate          # apply schema
pnpm db:seed             # insert demo session (optional)
pnpm dev                 # server :4000 + web :5173
```

Open http://localhost:5173 — you'll be redirected to `/sessions`. If you ran `db:seed`, one session is listed; click into it for the raw JSON view.

Send your own trace:

```bash
curl -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json
```

The browser will pick it up after refresh.

To wire up your own application (get a token, configure an OpenTelemetry exporter, annotate spans), see the integration guide: [`docs/integration/sending-traces.md`](docs/integration/sending-traces.md).

## Deploying the docs portal

The docs portal (`apps/docs`, VitePress) auto-deploys to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on every push to
`main` (or manually from the Actions tab).

**One-time setup:** in the repo's **Settings → Pages → Build and deployment →
Source**, choose **GitHub Actions**. After that, the site publishes to
<https://tiven-ai.github.io/Argus/>.

Locally: `pnpm --filter @argus/docs dev`.

## Repository layout

```
apps/
  server/      Node backend (Fastify, Kysely, Postgres)
  web/         React frontend (Vite, shadcn/ui)
packages/
  shared-types/    types/Zod schemas shared between server and web
  eslint-config/   shared lint config
  tsconfig/        shared tsconfig presets
docs/
  superpowers/specs/   design specs (brainstorming output)
  superpowers/plans/   implementation plans (writing-plans output)
  architecture/        long-form architecture
  adr/                 architecture decision records
  conventions/         coding, git, semantic conventions
  api/                 OpenAPI + SSE protocol docs
  design/              UI design system
infra/docker/          docker-compose for local Postgres
```

## Common commands

```bash
pnpm dev          # turbo: run all apps in parallel with hot reload
pnpm build        # build everything
pnpm test         # run all unit + integration tests
pnpm lint         # lint
pnpm typecheck    # typecheck
pnpm format       # prettier --write .
pnpm db:up        # docker compose up postgres
pnpm db:down      # docker compose down
```

## More

- Design spec: [`docs/superpowers/specs/2026-05-28-argus-design.md`](./docs/superpowers/specs/2026-05-28-argus-design.md)
- Architecture decisions: [`docs/adr/`](./docs/adr/)
- Contributing: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
