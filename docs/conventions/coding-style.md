# Coding Style

## TypeScript

- `strict: true` everywhere. No `any` without a `// reason:` comment.
- Prefer named exports. Default exports allowed for React pages/components.
- Use `import type` for type-only imports.
- File names: `kebab-case.ts` for modules, `PascalCase.tsx` for React components.

## Module layout (server)

Each module under `apps/server/src/modules/<name>/` owns:

- `index.ts` — public exports
- `routes.ts` — Fastify route declarations (if it has HTTP surface)
- `service.ts` — business logic
- `dao.ts` — data access (uses Kysely)
- `types.ts` — local types and Zod schemas
- `*.test.ts` — colocated tests

Modules talk to each other through their `index.ts` only. No reaching into a neighbor's internals.

## React components

- One component per file. Co-locate small subcomponents only when they're only used by their parent.
- Hooks: prefix with `use*`, placed under `src/lib/` or feature-local `hooks/`.
- Server state goes through TanStack Query. UI-only state in `useState` / Zustand.

## Tests

- Co-locate as `*.test.ts` next to the source, or in a parallel `test/` tree — pick one per package and stick to it.
- Each test names a behavior, not a function: `it('returns 401 when token is missing')` not `it('checkAuth')`.
- Integration tests use `testcontainers-node` for real Postgres.
