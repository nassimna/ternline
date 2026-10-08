# Ternline website

The Signal landing page, implemented as a static Astro site with Tailwind CSS and TypeScript.

From the repository root:

```sh
pnpm install
pnpm --filter @ternline/website dev
pnpm --filter @ternline/website typecheck
pnpm --filter @ternline/website build
pnpm --filter @ternline/website preview
```

The static output is `apps/website/dist`. This app does not use the desktop build, a database, or any containers.

Cloudflare Workers serves the static output at `https://ternline.com` and
`https://www.ternline.com`. To deploy from the repository root after authorizing
Wrangler:

```sh
SITE=https://ternline.com WEBSITE_BASE_PATH=/ pnpm build:website
npx wrangler deploy --config apps/website/wrangler.jsonc
```

Set `WEBSITE_RELEASE_VERSION` to the latest complete published release and
`RELEASE_SIGNATURES_AVAILABLE=true` only when all download signatures and the
public key are published, matching the checks in `.github/workflows/pages.yml`.
The existing GitHub Pages deployment remains separate.

The page uses the approved Signal direction. Its app screenshot shows the current dark UI with four fictional workspaces selected in blue, green, purple, and amber, alongside development and workspace CLI terminals. It was captured from an isolated profile on 8 October 2026. Documentation links are pinned to the PR #18 source revision containing the current app, SSH, and CLI updates; update them when the product documentation moves to the main branch.
