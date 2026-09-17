# Cloudflare hosting

Live site: https://jevlogs.com
Workers preview: https://jevlogs.workspaceagent.workers.dev

Deploy after an authenticated `wrangler login`:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run deploy
```

Use `pnpm run deploy` (not bare `pnpm deploy`). pnpm’s built-in `deploy` command is unrelated; the repo script builds the Astro site and runs `wrangler deploy`.

`wrangler.jsonc` serves the Astro `site/dist` assets and attaches the Worker Custom Domain `jevlogs.com`. No runtime secret or server is required. This repository's CI validates code but does not hold Cloudflare deploy credentials.

After deploy, verify HTTPS on `/`, `/guide/`, `/llms.txt`, and `/index.md` at both the custom domain and the workers.dev URL.
