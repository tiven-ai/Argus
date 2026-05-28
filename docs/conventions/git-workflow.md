# Git Workflow

## Branches

- `main` — protected. All changes via PR.
- Feature branches: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`, `docs/<short-name>`, `refactor/<short-name>`.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `revert`.
Scopes (current): `server`, `web`, `shared-types`, `infra`, `hooks`, `lint`, `tsconfig`, `turbo`, `changesets`, `ci`, `docs`, `adr`.

`commitlint` enforces this on `commit-msg` hook.

## Pull requests

PR description must include:

- Link to the spec or plan it implements
- Summary of what changed
- Test plan (what you ran, what you verified)
- Screenshots for any UI change

CI must pass before merge. At least one reviewer.

## Changesets

Every PR that changes published or user-visible behavior includes a changeset:

```bash
pnpm changeset
```

PRs without user-visible changes can be labeled `no-changeset`.
