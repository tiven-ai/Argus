# Argus M0 — Project Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the empty-but-runnable Argus monorepo: pnpm workspaces + Turbo, an empty Fastify server with `/healthz`, an empty React app that calls it, Tailwind v4 + shadcn/ui wired, Docker Compose for Postgres, full toolchain (TypeScript strict, ESLint, Prettier, Vitest, husky, commitlint, changesets), CI on GitHub Actions, and seed docs (README, CLAUDE.md, CONTRIBUTING.md, 4 ADRs).

**Architecture:** pnpm workspaces with `apps/server` + `apps/web` + 3 shared packages (`shared-types`, `eslint-config`, `tsconfig`). Turbo orchestrates `dev / build / test / lint / typecheck`. Vite dev server proxies `/api` and `/healthz` to the Fastify server so a single `pnpm dev` brings up the whole stack.

**Tech Stack:** Node 20+, pnpm 10, Turborepo 2, TypeScript 5 strict, Fastify 5, Vite 6, React 19, Tailwind v4, shadcn/ui, Vitest 2, ESLint 9 (flat config), Prettier 3, husky 9, commitlint 19, changesets 2, Postgres 16 via Docker.

**Reference spec:** [docs/superpowers/specs/2026-05-28-argus-design.md](../specs/2026-05-28-argus-design.md)

---

## File Structure (after M0)

```
argus/
├── .changeset/
│   └── config.json
├── .github/workflows/
│   └── ci.yml
├── .husky/
│   ├── pre-commit
│   └── commit-msg
├── apps/
│   ├── server/
│   │   ├── eslint.config.js
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   └── server.ts
│   │   ├── test/
│   │   │   └── healthz.test.ts
│   │   ├── tsconfig.json
│   │   └── tsconfig.build.json
│   └── web/
│       ├── components.json
│       ├── eslint.config.js
│       ├── index.html
│       ├── package.json
│       ├── src/
│       │   ├── App.tsx
│       │   ├── index.css
│       │   ├── main.tsx
│       │   └── vite-env.d.ts
│       ├── tsconfig.json
│       └── vite.config.ts
├── docs/
│   ├── adr/
│   │   ├── 0000-template.md
│   │   ├── 0001-postgres-not-clickhouse.md
│   │   ├── 0002-sse-not-websocket.md
│   │   ├── 0003-kysely-not-prisma.md
│   │   └── 0004-fastify-not-nestjs.md
│   ├── api/README.md
│   ├── architecture/README.md
│   ├── conventions/
│   │   ├── README.md
│   │   ├── coding-style.md
│   │   ├── git-workflow.md
│   │   └── semantic-conventions.md
│   ├── design/README.md
│   └── superpowers/         (already exists)
├── infra/
│   └── docker/
│       ├── .env.example
│       └── docker-compose.yml
├── packages/
│   ├── eslint-config/
│   │   ├── index.js
│   │   └── package.json
│   ├── shared-types/
│   │   ├── package.json
│   │   ├── src/index.ts
│   │   └── tsconfig.json
│   └── tsconfig/
│       ├── base.json
│       ├── node.json
│       ├── package.json
│       └── react.json
├── .gitignore                (extended)
├── .npmrc
├── .nvmrc
├── .prettierignore
├── .prettierrc.json
├── CLAUDE.md
├── CONTRIBUTING.md
├── README.md
├── commitlint.config.cjs
├── lint-staged.config.cjs
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Task 1: Initialize root monorepo scaffolding

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`
- Create: `.nvmrc`
- Modify: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "argus",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "prettier --write .",
    "db:up": "docker compose -f infra/docker/docker-compose.yml up -d",
    "db:down": "docker compose -f infra/docker/docker-compose.yml down",
    "prepare": "husky"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "@commitlint/cli": "^19.0.0",
    "@commitlint/config-conventional": "^19.0.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.0.0",
    "prettier": "^3.3.0",
    "turbo": "^2.3.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 3: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
shamefully-hoist=false
```

- [ ] **Step 4: Create `.nvmrc`**

```
20
```

- [ ] **Step 5: Extend `.gitignore` (append the following block at the end, keep existing content)**

```
# pnpm / turbo / build
node_modules/
.pnpm-store/
.turbo/
.vite/
dist/
build/
coverage/

# env files
.env
.env.local

# editor / OS
.DS_Store
*.log
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml .npmrc .nvmrc .gitignore
git commit -m "chore: init pnpm monorepo scaffold"
```

---

## Task 2: TypeScript shared config package

**Files:**

- Create: `packages/tsconfig/package.json`
- Create: `packages/tsconfig/base.json`
- Create: `packages/tsconfig/node.json`
- Create: `packages/tsconfig/react.json`

- [ ] **Step 1: Create `packages/tsconfig/package.json`**

```json
{
  "name": "@argus/tsconfig",
  "version": "0.0.0",
  "private": true,
  "files": ["base.json", "node.json", "react.json"]
}
```

- [ ] **Step 2: Create `packages/tsconfig/base.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist", "build"]
}
```

- [ ] **Step 3: Create `packages/tsconfig/node.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "types": ["node"]
  }
}
```

- [ ] **Step 4: Create `packages/tsconfig/react.json`**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/tsconfig
git commit -m "chore(tsconfig): add shared TypeScript configs"
```

---

## Task 3: ESLint shared config + Prettier

**Files:**

- Create: `packages/eslint-config/package.json`
- Create: `packages/eslint-config/index.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`

- [ ] **Step 1: Create `packages/eslint-config/package.json`**

```json
{
  "name": "@argus/eslint-config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "index.js",
  "dependencies": {
    "@eslint/js": "^9.0.0",
    "eslint-config-prettier": "^9.0.0",
    "globals": "^15.0.0",
    "typescript-eslint": "^8.0.0"
  },
  "peerDependencies": {
    "eslint": "^9.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/eslint-config/index.js`**

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/build/**', '**/.turbo/**', '**/coverage/**'],
  },
  prettier,
]
```

- [ ] **Step 3: Create `.prettierrc.json`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

- [ ] **Step 4: Create `.prettierignore`**

```
node_modules
dist
build
.turbo
.vite
coverage
pnpm-lock.yaml
*.lock
```

- [ ] **Step 5: Commit**

```bash
git add packages/eslint-config .prettierrc.json .prettierignore
git commit -m "chore(lint): add shared ESLint flat config and Prettier"
```

---

## Task 4: Turborepo configuration

**Files:**

- Create: `turbo.json`

- [ ] **Step 1: Create `turbo.json`**

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "outputs": ["dist/**"],
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true,
      "dependsOn": ["^build"]
    },
    "test": {
      "outputs": ["coverage/**"],
      "dependsOn": ["^build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add turbo.json
git commit -m "chore(turbo): add pipeline configuration"
```

---

## Task 5: Shared types package (placeholder)

**Files:**

- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Create `packages/shared-types/package.json`**

```json
{
  "name": "@argus/shared-types",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@argus/eslint-config": "workspace:*",
    "@argus/tsconfig": "workspace:*",
    "eslint": "^9.0.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/shared-types/tsconfig.json`**

```json
{
  "extends": "@argus/tsconfig/base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared-types/src/index.ts`**

```ts
// Placeholder. Real shared types added starting M1.
export {}
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types
git commit -m "chore(shared-types): add placeholder package"
```

---

## Task 6: Server skeleton (no business logic, no /healthz yet)

**Files:**

- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/tsconfig.build.json`
- Create: `apps/server/eslint.config.js`

- [ ] **Step 1: Create `apps/server/package.json`**

```json
{
  "name": "@argus/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@argus/eslint-config": "workspace:*",
    "@argus/tsconfig": "workspace:*",
    "@types/node": "^22.0.0",
    "eslint": "^9.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/server/tsconfig.json`**

```json
{
  "extends": "@argus/tsconfig/node.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Create `apps/server/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["test/**/*", "**/*.test.ts"]
}
```

- [ ] **Step 4: Create `apps/server/eslint.config.js`**

```js
import config from '@argus/eslint-config'
export default config
```

- [ ] **Step 5: Install workspace deps and verify**

```bash
pnpm install
```

Expected: pnpm installs all workspace deps and lockfile is written. `pnpm-lock.yaml` appears at root.

- [ ] **Step 6: Commit**

```bash
git add apps/server pnpm-lock.yaml
git commit -m "chore(server): scaffold empty Fastify app package"
```

---

## Task 7: Server `/healthz` endpoint (TDD)

**Files:**

- Test: `apps/server/test/healthz.test.ts`
- Create: `apps/server/src/server.ts`
- Create: `apps/server/src/main.ts`

- [ ] **Step 1: Write the failing test `apps/server/test/healthz.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../src/server.js'

describe('GET /healthz', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app) await app.close()
  })

  it('returns 200 and { status: "ok" }', async () => {
    app = createServer()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @argus/server test`
Expected: FAIL — `Cannot find module '../src/server.js'` (or similar).

- [ ] **Step 3: Implement `apps/server/src/server.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify'

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  })

  app.get('/healthz', async () => ({ status: 'ok' }))

  return app
}
```

- [ ] **Step 4: Implement `apps/server/src/main.ts`**

```ts
import { createServer } from './server.js'

const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? '0.0.0.0'

const app = createServer()

app
  .listen({ port, host })
  .then(() => {
    app.log.info(`Argus server listening on http://${host}:${port}`)
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm --filter @argus/server test`
Expected: PASS — 1 test passed.

- [ ] **Step 6: Smoke-run the server manually**

Run: `pnpm --filter @argus/server dev`
In another terminal: `curl -s http://localhost:4000/healthz`
Expected: `{"status":"ok"}`
Kill the dev process (`Ctrl+C`).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src apps/server/test
git commit -m "feat(server): add /healthz endpoint"
```

---

## Task 8: Web app skeleton with Vite, React 19, Tailwind v4

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/vite-env.d.ts`
- Create: `apps/web/components.json`
- Create: `apps/web/eslint.config.js`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@argus/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@argus/eslint-config": "workspace:*",
    "@argus/tsconfig": "workspace:*",
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "eslint": "^9.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "@argus/tsconfig/react.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*", "vite-env.d.ts"]
}
```

- [ ] **Step 3: Create `apps/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/healthz': 'http://localhost:4000',
    },
  },
})
```

- [ ] **Step 4: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Argus</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `apps/web/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 6: Create `apps/web/src/index.css`**

```css
@import 'tailwindcss';

:root {
  color-scheme: light;
}

html,
body,
#root {
  height: 100%;
}
```

- [ ] **Step 7: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 8: Create `apps/web/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'

type HealthStatus = 'loading' | 'ok' | 'error'

export default function App() {
  const [status, setStatus] = useState<HealthStatus>('loading')

  useEffect(() => {
    fetch('/healthz')
      .then((r) => r.json() as Promise<{ status: string }>)
      .then((d) => setStatus(d.status === 'ok' ? 'ok' : 'error'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center bg-white text-neutral-900">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold tracking-tight">Argus</h1>
        <p className="text-neutral-500">
          Server status: <span className="font-mono">{status}</span>
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 9: Create `apps/web/components.json` (shadcn config; components are added on-demand later)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "utils": "@/lib/utils",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 10: Create `apps/web/eslint.config.js`**

```js
import config from '@argus/eslint-config'
export default config
```

- [ ] **Step 11: Install deps and verify build**

```bash
pnpm install
pnpm --filter @argus/web build
```

Expected: `apps/web/dist/` is created with `index.html` and asset files.

- [ ] **Step 12: Smoke-run the full stack manually**

Terminal 1: `pnpm --filter @argus/server dev`
Terminal 2: `pnpm --filter @argus/web dev`
Open `http://localhost:5173` in a browser.
Expected: "Argus" headline, "Server status: ok".
Kill both processes.

- [ ] **Step 13: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): scaffold Vite + React 19 + Tailwind v4 app with health check"
```

---

## Task 9: Docker Compose for Postgres

**Files:**

- Create: `infra/docker/docker-compose.yml`
- Create: `infra/docker/.env.example`

- [ ] **Step 1: Create `infra/docker/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: argus-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: argus
      POSTGRES_PASSWORD: argus
      POSTGRES_DB: argus
    ports:
      - '5432:5432'
    volumes:
      - argus-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U argus -d argus']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  argus-pgdata:
```

- [ ] **Step 2: Create `infra/docker/.env.example`**

```
DATABASE_URL=postgres://argus:argus@localhost:5432/argus
PORT=4000
HOST=0.0.0.0
LOG_LEVEL=info
```

- [ ] **Step 3: Smoke-test Postgres is reachable**

```bash
pnpm db:up
docker exec argus-postgres pg_isready -U argus -d argus
pnpm db:down
```

Expected:

- First command: `Container argus-postgres  Started`
- Second: `localhost:5432 - accepting connections`
- Third: container stopped cleanly.

- [ ] **Step 4: Commit**

```bash
git add infra/docker
git commit -m "chore(infra): add docker-compose for Postgres"
```

---

## Task 10: husky + lint-staged + commitlint

**Files:**

- Create: `commitlint.config.cjs`
- Create: `lint-staged.config.cjs`
- Create: `.husky/pre-commit`
- Create: `.husky/commit-msg`

- [ ] **Step 1: Create `commitlint.config.cjs`**

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
}
```

- [ ] **Step 2: Create `lint-staged.config.cjs`**

```js
module.exports = {
  '*.{ts,tsx,js,jsx,json,md,yml,yaml,css}': ['prettier --write'],
}
```

- [ ] **Step 3: Initialize husky and create hooks**

```bash
pnpm exec husky init
```

This creates `.husky/pre-commit` with a default body. Replace its content with:

```sh
pnpm exec lint-staged
```

- [ ] **Step 4: Create `.husky/commit-msg`**

```sh
pnpm exec commitlint --edit "$1"
```

Make it executable:

```bash
chmod +x .husky/commit-msg
```

- [ ] **Step 5: Verify hooks trigger**

Make a no-op change to a markdown file, then attempt a commit with a bad message:

```bash
echo "" >> README.md   # README.md does not exist yet; use any tracked file
# (if README.md doesn't exist, skip this verification until Task 13)
```

> NOTE: full hook verification happens at acceptance Task 15. This step just confirms file structure is correct.

- [ ] **Step 6: Commit**

```bash
git add .husky commitlint.config.cjs lint-staged.config.cjs
git commit -m "chore(hooks): wire husky + lint-staged + commitlint"
```

---

## Task 11: changesets initialization

**Files:**

- Create: `.changeset/config.json`
- Create: `.changeset/README.md`

- [ ] **Step 1: Initialize changesets**

```bash
pnpm exec changeset init
```

This creates `.changeset/config.json` and `.changeset/README.md` with defaults.

- [ ] **Step 2: Edit `.changeset/config.json`** to mark the project as private (no npm publishing in M0):

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 3: Commit**

```bash
git add .changeset
git commit -m "chore(changesets): initialize"
```

---

## Task 12: docs/ directory scaffolding

**Files:**

- Create: `docs/architecture/README.md`
- Create: `docs/adr/0000-template.md`
- Create: `docs/adr/0001-postgres-not-clickhouse.md`
- Create: `docs/adr/0002-sse-not-websocket.md`
- Create: `docs/adr/0003-kysely-not-prisma.md`
- Create: `docs/adr/0004-fastify-not-nestjs.md`
- Create: `docs/api/README.md`
- Create: `docs/conventions/README.md`
- Create: `docs/conventions/coding-style.md`
- Create: `docs/conventions/git-workflow.md`
- Create: `docs/conventions/semantic-conventions.md`
- Create: `docs/design/README.md`

- [ ] **Step 1: Create `docs/architecture/README.md`**

```markdown
# Argus Architecture

Long-form architecture docs (C4 diagrams, module responsibilities, sequence diagrams) live in this folder.

For the M0 baseline architecture, see the design spec:
[`docs/superpowers/specs/2026-05-28-argus-design.md`](../superpowers/specs/2026-05-28-argus-design.md).

This folder grows with the system. Update on every large refactor.
```

- [ ] **Step 2: Create `docs/adr/0000-template.md`**

```markdown
# ADR-NNNN — <Title>

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD

## Context

What's the situation that forces a decision?

## Decision

What did we decide?

## Consequences

What changes because of this? (good and bad)

## Alternatives Considered

What else did we look at, and why didn't we pick it?
```

- [ ] **Step 3: Create `docs/adr/0001-postgres-not-clickhouse.md`**

```markdown
# ADR-0001 — Use PostgreSQL (not ClickHouse) for MVP storage

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

Argus stores OpenTelemetry spans/events for AI agent observability. The two leading choices for trace backends are PostgreSQL (JSONB + partitioning) and ClickHouse (columnar, OTel-friendly).

## Decision

MVP (M0–M6) uses PostgreSQL 16+ with JSONB columns and time-based partitioning. The data layer is abstracted behind a `StorageBackend` interface so a ClickHouse implementation can be added later without rewriting business logic.

## Consequences

- ✅ Trivial local setup (one Docker container), low ops burden in private deployments.
- ✅ Rich SQL + JSONB lets us index attributes for the queries we need (by `trace_id`, by `argus.step.kind`).
- ✅ Same DB serves both metadata (orgs/projects/users) and trace data — single transactional boundary.
- ⚠️ Aggregation queries over 10M+ spans will be slow; we accept this as a tomorrow problem.
- ⚠️ When we move to SaaS scale, we will pay the cost of implementing a second `StorageBackend`.

## Alternatives Considered

- **ClickHouse**: industry-standard for OTel trace storage. Rejected for MVP because operating ClickHouse adds significant complexity (replication model, ZooKeeper / Keeper, schema migrations) for a system that won't see that data volume yet.
- **SQLite**: too limiting for the multi-tenant SaaS goal.
```

- [ ] **Step 4: Create `docs/adr/0002-sse-not-websocket.md`**

```markdown
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
```

- [ ] **Step 5: Create `docs/adr/0003-kysely-not-prisma.md`**

```markdown
# ADR-0003 — Use Kysely (not Prisma) for the data-access layer

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

The Node ecosystem's two leading typed data-access tools are Prisma (ORM with a custom schema language) and Kysely (typed SQL query builder).

## Decision

Use Kysely + `kysely-codegen` (types from the live DB schema) + `kysely-migrator` (or `node-pg-migrate`) for migrations.

## Consequences

- ✅ Typed SQL we write by hand — no hidden N+1, no query-builder mystery.
- ✅ Generated types from real schema mean a `migration → codegen → compile` loop catches drift in CI.
- ✅ Lightweight; no separate engine process or schema language to learn.
- ⚠️ Migration tooling is less polished than Prisma's; we pick a separate migrator and own the integration.
- ⚠️ Some advanced ergonomics (relations, includes) are more boilerplate than Prisma's.

## Alternatives Considered

- **Prisma**: nice DX but the Prisma engine adds a separate binary, Prisma Schema is a language we'd rather not maintain, and JSONB ergonomics are weaker than raw SQL.
- **Drizzle**: close call. Kysely picked for stricter typing and more idiomatic SQL.
- **Raw `pg`**: too much repetition for a project with dozens of tables.
```

- [ ] **Step 6: Create `docs/adr/0004-fastify-not-nestjs.md`**

```markdown
# ADR-0004 — Use Fastify (not NestJS) for the backend

- **Status:** Accepted
- **Date:** 2026-05-28

## Context

The Argus server handles two distinct workloads: OTLP ingest (high-throughput, schema-validated) and a REST + SSE query API. We compared Fastify (lightweight plugin model) and NestJS (Spring-style framework with DI/decorators).

## Decision

Use Fastify v5 directly. Organize the codebase by module folders (`ingest/`, `storage/`, `pubsub/`, `api/`, `auth/`), wiring dependencies explicitly in module factories.

## Consequences

- ✅ Highest-throughput Node web framework — matters for OTLP ingest path.
- ✅ Built-in JSON Schema validation via Ajv; pairs well with Zod for type-shared validation.
- ✅ Less framework boilerplate; faster startup, faster tests, smaller mental model.
- ⚠️ No built-in DI container — we wire dependencies by hand. Acceptable given the project's size.
- ⚠️ Less framework-imposed structure means we enforce conventions via code review and lint.

## Alternatives Considered

- **NestJS**: strong structure, large ecosystem. Rejected because the DI/decorator overhead is more burden than benefit at our size, and the default Express engine is significantly slower than Fastify (the Fastify adapter exists but adds a configuration layer).
- **Express**: too minimal — no built-in validation, no schema-first ergonomics.
- **Hono / Elysia**: modern and fast but with smaller plugin ecosystems for OTel and observability tooling.
```

- [ ] **Step 7: Create `docs/api/README.md`**

```markdown
# Argus HTTP API

The full OpenAPI spec is generated from Zod schemas in `apps/server` and published to `openapi.yaml` in this folder by CI.

The SSE protocol for `/api/sessions/:id/stream` is documented in `sse-protocol.md` once the live session feature ships (M3).

For the high-level shape of the API, see the design spec:
[`docs/superpowers/specs/2026-05-28-argus-design.md`](../superpowers/specs/2026-05-28-argus-design.md).
```

- [ ] **Step 8: Create `docs/conventions/README.md`**

```markdown
# Conventions

- [`coding-style.md`](./coding-style.md) — TypeScript, naming, file organization
- [`git-workflow.md`](./git-workflow.md) — branches, commits, PR process
- [`semantic-conventions.md`](./semantic-conventions.md) — Argus extension attributes for OTel spans (client integration guide)
```

- [ ] **Step 9: Create `docs/conventions/coding-style.md`**

```markdown
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
```

- [ ] **Step 10: Create `docs/conventions/git-workflow.md`**

````markdown
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
````

- [ ] **Step 11: Create `docs/conventions/semantic-conventions.md`**

```markdown
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
```

- [ ] **Step 12: Create `docs/design/README.md`**

```markdown
# Argus Design System

Visual design follows Ubiquiti's Unifi Console aesthetic. The full design tokens (colors, spacing, typography, component patterns) live in `DESIGN.md` (delivered separately).

Until `DESIGN.md` lands, the UI uses shadcn/ui defaults with the `neutral` base color. M5 maps the Unifi tokens into Tailwind's theme.
```

- [ ] **Step 13: Commit**

```bash
git add docs
git commit -m "docs: add architecture/conventions/adr scaffolding and first 4 ADRs"
```

---

## Task 13: Root README, CLAUDE.md, CONTRIBUTING.md

**Files:**

- Create: `README.md`
- Create: `CLAUDE.md`
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create `README.md`**

````markdown
# Argus

> Observability for AI agents — see every step of a session: prompts, model calls, tool calls (Skill / MCP / Middleware / custom), and external resources (DB / HTTP / Redis).

Argus is named after the hundred-eyed giant in Greek mythology — built to watch everything.

## Quick start (5 minutes)

Requirements: Node 20+, pnpm 10+, Docker (for Postgres).

```bash
git clone <this-repo>
cd argus
pnpm install
pnpm db:up           # start Postgres on :5432
pnpm dev             # start server (:4000) and web (:5173)
```
````

Open http://localhost:5173 — you should see the **Argus** headline with `Server status: ok`.

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

- Design spec: [`docs/superpowers/specs/2026-05-28-argus-design.md`](../specs/2026-05-28-argus-design.md)
- Architecture decisions: [`docs/adr/`](../../adr/)
- Contributing: [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)

````

- [ ] **Step 2: Create `CLAUDE.md`**

```markdown
# Argus — AI Collaborator Notes

This file is read by Claude Code (and other AI assistants) when working on this repo.

## What this project is

Argus is an observability system for AI agent programs. It accepts OpenTelemetry traces and renders an agent session as a step-by-step replay (left pane: ordered steps; right pane: structured detail per step). Single-session debugging is the MVP value; production monitoring and product analytics are future extensions.

The high-level design lives in `docs/superpowers/specs/2026-05-28-argus-design.md` — start there.

## Source of truth, by topic

| Question                          | Read this                                                              |
|-----------------------------------|------------------------------------------------------------------------|
| Why was X built this way?         | `docs/adr/`                                                            |
| What's the next thing to build?   | `docs/superpowers/plans/` (latest dated file in the active milestone)  |
| What does the data look like?     | `docs/conventions/semantic-conventions.md`                             |
| How do I run it?                  | `README.md`                                                            |
| Project conventions               | `docs/conventions/`                                                    |

## Working rules

- All new features go through `brainstorming → writing-plans → executing-plans` skills. Don't skip ahead to code.
- Every PR is a small step. Frequent commits. TDD where the unit is testable.
- Don't introduce a new external service (Redis, Kafka, ClickHouse, etc.) without an ADR.
- Keep modules small and focused. Module ↔ module communication only through `index.ts`.
- Strict TypeScript everywhere. No `any` without a `// reason:` comment.
- Never use `git commit --no-verify` or `--no-gpg-sign` unless explicitly asked.

## Repo orientation

- Backend: `apps/server` — Fastify + Kysely + Postgres
- Frontend: `apps/web` — Vite + React 19 + Tailwind v4 + shadcn/ui + TanStack Router/Query
- Shared TypeScript types and Zod schemas: `packages/shared-types`
- Lint/tsconfig presets: `packages/eslint-config` and `packages/tsconfig`

## Common pitfalls

- **Don't add to `attributes` what belongs in a Span Event** — see `docs/conventions/semantic-conventions.md`.
- **Don't add a Postgres query that doesn't filter by `org_id`** — multi-tenant boundary. Use the `withTenant` DAO helper once it exists.
- **Don't add UI strings without translating** to en/zh-CN/ja once i18n lands in M6.
````

- [ ] **Step 3: Create `CONTRIBUTING.md`**

````markdown
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
````

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

````

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md CONTRIBUTING.md
git commit -m "docs: add README, CLAUDE.md, CONTRIBUTING.md"
````

---

## Task 14: GitHub Actions CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: lint · typecheck · test · build
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: argus
          POSTGRES_PASSWORD: argus
          POSTGRES_DB: argus
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgres://argus:argus@localhost:5432/argus

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (lint/typecheck/test/build)"
```

---

## Task 15: Full acceptance run

This task verifies the M0 deliverable end-to-end. No new code; only running commands and confirming output.

- [ ] **Step 1: Clean install from scratch**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

Expected: completes without errors; lockfile is unchanged.

- [ ] **Step 2: Run typecheck across the workspace**

```bash
pnpm typecheck
```

Expected: 0 errors across all packages.

- [ ] **Step 3: Run lint across the workspace**

```bash
pnpm lint
```

Expected: 0 errors.

- [ ] **Step 4: Run all tests**

```bash
pnpm test
```

Expected: `apps/server` healthz test passes; other packages have no tests (or pass trivially). Exit code 0.

- [ ] **Step 5: Run the full build**

```bash
pnpm build
```

Expected:

- `apps/server/dist/main.js` exists
- `apps/web/dist/index.html` exists
- `packages/shared-types/dist/index.js` exists
- Exit code 0.

- [ ] **Step 6: Bring up the dev stack and verify**

```bash
pnpm db:up
pnpm dev
```

Wait until both processes log "ready". Then:

- Browser → `http://localhost:5173` shows "Argus" headline and `Server status: ok`
- `curl -s http://localhost:4000/healthz` returns `{"status":"ok"}`

Kill the dev process. Tear down Postgres:

```bash
pnpm db:down
```

- [ ] **Step 7: Verify husky hooks reject a non-conventional commit**

Make a trivial change (e.g., add a blank line to `README.md`):

```bash
git add README.md
git commit -m "bad message"
```

Expected: commit is rejected by `commitlint` (`type may not be empty`). Then commit properly:

```bash
git commit -m "chore: smoke-test commit hook"
```

Expected: commit succeeds and `prettier --write` runs on the staged file.

Then revert that smoke commit:

```bash
git reset --hard HEAD~1
```

- [ ] **Step 8: Push the branch and confirm CI passes (if remote is configured)**

```bash
git push -u origin main
```

Wait for GitHub Actions. Expected: workflow `CI / lint · typecheck · test · build` is green.

> If no remote is configured yet, skip this step. CI verification will happen on first PR.

- [ ] **Step 9: M0 done — tag the milestone**

```bash
git tag -a m0-bootstrap -m "M0 bootstrap complete"
```

Push the tag when ready:

```bash
git push origin m0-bootstrap   # only if remote exists
```

---

## Acceptance summary

M0 is complete when **every** check passes:

- [ ] `pnpm install` completes from scratch with no errors
- [ ] `pnpm typecheck` clean
- [ ] `pnpm lint` clean
- [ ] `pnpm test` passes (at minimum the `/healthz` test)
- [ ] `pnpm build` produces output for `apps/server`, `apps/web`, `packages/shared-types`
- [ ] `pnpm dev` brings both server and web up; browser shows "Server status: ok"
- [ ] `pnpm db:up` / `pnpm db:down` start/stop Postgres cleanly
- [ ] husky hooks reject a non-conventional commit message
- [ ] husky hooks auto-format staged files
- [ ] GitHub Actions CI is green (if remote configured)
- [ ] All 4 ADRs, all conventions docs, README/CLAUDE/CONTRIBUTING exist and are coherent

The repository is now ready to start **M1 — Minimal closed-loop (OTLP ingest + session list + raw-JSON detail page)**.
