# v0.1 release

- TypeScript SDK, Astro website, integration guide, MIT license.
- Locally tested contracts; no live Jev certification or production savings benchmark.
- AI SDK experimental evaluation API pinned to 7.0.105.
- Before npm publishing: confirm package ownership, run tests/build, inspect `pnpm pack` output, supply Gateway access for a synthetic smoke, choose exact package name, then `pnpm publish --access public`.
- Website: build `pnpm --filter jevlogs-site build`; publish `site/dist` with any static host. GitHub Actions builds the source on push; it does not publish npm automatically.

## Announcement draft

Introducing Jev Logs: an open-source TypeScript layer for OpenTelemetry that uses Jev to decide which logs deserve expensive LLM analysis.

Score diagnostic value, prioritize failures, and route only the useful signal to your reasoning model. Start with annotations; keep your existing archive. Errors, protected records, uncertainty, and provider failures stay on the analysis path.

Built with Vercel AI SDK. MIT licensed. Astro docs + an adjustable savings calculator. This is v0.1: bring your Gateway key and benchmark it on your own logs.

Source: https://github.com/reachjalil/jevlogs
