# Cloudflare hosting

Current site: https://jevlogs.workspaceagent.workers.dev
Intended canonical domain: https://jevlogs.com

Deploy after an authenticated `wrangler login`:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm deploy
```

`wrangler.jsonc` serves the Astro `site/dist` assets. No runtime secret or server is required. This repository's CI validates code but does not hold Cloudflare deploy credentials.

## Connect jevlogs.com

The domain is not yet present in the connected Cloudflare account. Its nameservers currently point at registrar-servers.com. To use a Worker Custom Domain, first add the existing domain to the intended Cloudflare account, preserve any mail/other DNS records, and use Cloudflare's assigned nameservers at the registrar. Do not guess nameserver values.

After Cloudflare reports the zone active, add to `wrangler.jsonc`:

```json
"routes": [{ "pattern": "jevlogs.com", "custom_domain": true }]
```

Then run `pnpm deploy` and verify HTTPS on both `/` and `/guide/` at the custom domain. The Cloudflare deployment is live independently of this DNS step.

Reference: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
