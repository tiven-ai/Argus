# Contributing

## Requirements

- Node 20+
- pnpm 10+
- Docker (for local Postgres)

## Development loop

```bash
pnpm install
pnpm db:up
pnpm dev
```

Server: http://localhost:4000 · Web: http://localhost:5173

## Branch / commit / PR

- Branch off `main`: `feat/<short-name>`, `fix/<short-name>`, etc.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(server): add /v1/traces ingest`
- `commitlint` and `lint-staged` run via husky hooks on every commit — don't bypass them.
- Open a PR linking the spec/plan it implements. Include a test plan and screenshots for UI changes.

## Tests

```bash
pnpm test         # all
pnpm --filter @argus/server test
pnpm --filter @argus/web test
```

Integration tests use `testcontainers-node` for a real Postgres; Docker must be running.

## Changesets

If your PR changes user-visible behavior, run:

```bash
pnpm changeset
```

Pick the affected packages and a bump type. Commit the generated changeset file. PRs without changesets need the `no-changeset` label.

## When in doubt

Read `docs/conventions/`. If it's not answered there, ask in the PR.
