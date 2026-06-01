import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Argus',
  description: 'Observability for AI agents',

  // GitHub Pages serves this project site under /Argus/. Use that base only in
  // CI (GITHUB_ACTIONS is set by the runner); local dev/build stay at '/'.
  base: process.env.GITHUB_ACTIONS ? '/Argus/' : '/',

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

  themeConfig: {
    // Shared across locales. Per-locale nav/sidebar live under `locales`.
    search: { provider: 'local' },
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Integration', link: '/content/integration/sending-traces' },
          { text: 'Conventions', link: '/content/conventions/semantic-conventions' },
        ],
        sidebar: [
          {
            text: 'Get started',
            items: [{ text: 'Sending traces', link: '/content/integration/sending-traces' }],
          },
          {
            text: 'Reference',
            items: [
              { text: 'Semantic conventions', link: '/content/conventions/semantic-conventions' },
            ],
          },
        ],
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: {
        nav: [
          { text: '接入', link: '/zh/integration/sending-traces' },
          { text: '约定', link: '/zh/conventions/semantic-conventions' },
        ],
        sidebar: [
          {
            text: '快速开始',
            items: [{ text: '发送 trace', link: '/zh/integration/sending-traces' }],
          },
          {
            text: '参考',
            items: [{ text: '语义约定', link: '/zh/conventions/semantic-conventions' }],
          },
        ],
      },
    },
    ja: {
      label: '日本語',
      lang: 'ja',
      link: '/ja/',
      themeConfig: {
        nav: [
          { text: '導入', link: '/ja/integration/sending-traces' },
          { text: '規約', link: '/ja/conventions/semantic-conventions' },
        ],
        sidebar: [
          {
            text: 'はじめに',
            items: [{ text: 'トレースの送信', link: '/ja/integration/sending-traces' }],
          },
          {
            text: 'リファレンス',
            items: [{ text: 'セマンティック規約', link: '/ja/conventions/semantic-conventions' }],
          },
        ],
      },
    },
  },
})
