import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Argus',
  description: 'Observability for AI agents',

  // Source files live under content/ (a symlink to the repo's docs/), so the
  // real markdown sits inside the VitePress root. preserveSymlinks keeps Vite
  // resolving them as if they live here (else vue/server-renderer can't resolve
  // from the symlink's real path, and relative links escape the content/ tree).
  // Note: a fresh clone needs git core.symlinks=true (default on macOS/Linux/CI;
  // on Windows it requires Developer Mode or admin).
  vite: { resolve: { preserveSymlinks: true } },

  // Exclude everything internal; publish only the customer-facing pages.
  // To publish a NEW page, add it under docs/integration/ or docs/conventions/
  // — no config change needed (publishing is opt-out, not opt-in). README.md
  // files are contributor-facing orientation, not portal pages, so excluded.
  srcExclude: [
    'content/superpowers/**',
    'content/adr/**',
    'content/architecture/**',
    'content/design/**',
    'content/api/**',
    'content/**/README.md',
    'content/conventions/coding-style.md',
    'content/conventions/git-workflow.md',
  ],

  // Published pages link to targets that aren't part of the portal: the example
  // payload outside docs/ (href ../../scripts/example-trace.json), the excluded
  // api/README, and example dev-server URLs. Anchor each so we don't accidentally
  // ignore some other broken link; all real in-portal links stay checked.
  ignoreDeadLinks: [
    /\/scripts\/example-trace\.json$/,
    /\/api\/README$/,
    /^https?:\/\/localhost(?::\d+)?(?:\/|$)/,
  ],
})
